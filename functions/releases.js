// SPDX-License-Identifier: GPL-2.0-or-later

// Cloudflare Pages Function — the OS list, proxied so every flavor uses the same
// origin. Unauthenticated GitHub API calls from Cloudflare's shared egress IPs get
// rate-limited intermittently, so we layer three defenses:
//   1. edge cache for 10 min — one good fetch serves everyone,
//   2. retry the cold fetch a few times — Cloudflare rotates egress IPs, so a retry
//      usually lands on one that isn't rate-limited,
//   3. a GITHUB_TOKEN if set on the Pages project (5000/h, no shared-IP limit).
//
// Route: GET /releases            -> tc8-firmware-build's GitHub releases (JSON)
//        GET /releases?device=c60 -> the C60 firmware repo's releases
//
// `device` selects the source repo from the allowlist below; omitted = tc8, so
// clients shipped before the param existed keep working unchanged.

const REPOS = {
  tc8: "Polycom-Open-Firmware/tc8-firmware-build",
  c60: "Polycom-Open-Firmware/c60-firmware-build",
};
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const reqUrl = new URL(request.url);
  const device = reqUrl.searchParams.get("device") || "tc8";
  const repo = REPOS[device];
  if (!repo) return new Response("unknown device", { status: 400, headers: CORS });

  const cache = caches.default;
  const cacheKey = new Request(reqUrl.origin + "/releases?device=" + device);
  // `?fresh` (the in-app refresh button) bypasses the edge cache for an on-demand
  // pull; normal loads serve the shared cache. Either way we refresh the cache.
  const bypass = reqUrl.searchParams.has("fresh");
  if (!bypass) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "openpolycom-provisioner",
  };
  if (env && env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const url = `https://api.github.com/repos/${repo}/releases?per_page=20`;
  let body = "[]";
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    const upstream = await fetch(url, { headers, cf: { cacheTtl: 0 } });
    if (upstream.ok) {
      body = await upstream.text();
      ok = true;
    }
  }

  // Only cache a good list; pass failures through as 502 so the app's `r.ok`
  // check skips them (and we don't cache a rate-limit error for 10 minutes).
  const resp = new Response(body, {
    status: ok ? 200 : 502,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=180" },
  });
  if (ok) await cache.put(cacheKey, resp.clone());
  return resp;
}
