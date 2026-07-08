// SPDX-License-Identifier: GPL-2.0-or-later

// Cloudflare Pages Function — the application catalog's version source. Reads
// the OpenPolycom apt archive's Packages index and returns the poly-app-*
// entries, so the wizard's Application tiles can show the latest published
// version of each app. The archive only ever publishes the latest version of
// a package, so "what's in the index" IS "the latest".
//
// Route: GET /apps -> [{ name, version, description }]

const PACKAGES_URL =
  "https://pub-1d222577af244182a265fc4d6a35b994.r2.dev/dists/stable/main/binary-arm64/Packages";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const reqUrl = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(reqUrl.origin + "/apps");
  const bypass = reqUrl.searchParams.has("fresh");
  if (!bypass) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let apps = [];
  const upstream = await fetch(PACKAGES_URL, { cf: { cacheTtl: 0 } });
  if (upstream.ok) {
    const text = await upstream.text();
    // Debian Packages index: RFC822-ish stanzas separated by blank lines.
    for (const stanza of text.split(/\n\n+/)) {
      const get = (k) => {
        const m = stanza.match(new RegExp("^" + k + ": (.*)$", "m"));
        return m ? m[1].trim() : "";
      };
      const name = get("Package");
      if (!name.startsWith("poly-app-")) continue;
      apps.push({ name, version: get("Version"), description: get("Description") });
    }
  }

  const res = new Response(JSON.stringify(apps), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      ...CORS,
    },
  });
  await cache.put(cacheKey, res.clone());
  return res;
}
