// Cloudflare Pages Function — the OS list, proxied so every flavor uses the same
// origin. Unauthenticated GitHub API calls from Cloudflare's shared egress IPs get
// rate-limited intermittently, so we (a) serve from the edge cache for 10 min — one
// GitHub hit refreshes it for everyone — and (b) use a GITHUB_TOKEN if one is set
// on the Pages project (5000/h authenticated, no shared-IP limit).
//
// Route: GET /releases  -> tc8-firmware-build's GitHub releases (JSON)

const REPO = "Polycom-Open-Firmware/tc8-firmware-build";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + "/releases");
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "openpolycom-provisioner",
  };
  if (env && env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const upstream = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers,
  });
  const body = await upstream.text();

  // Only cache a good list; pass failures through as 502 so the app's `r.ok`
  // check skips them (and doesn't cache a rate-limit error for 10 minutes).
  const resp = new Response(body, {
    status: upstream.ok ? 200 : 502,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=600" },
  });
  if (upstream.ok) await cache.put(cacheKey, resp.clone());
  return resp;
}
