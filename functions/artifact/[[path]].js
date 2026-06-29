// Cloudflare Pages Function — the single artifact path for every flavor. Streams a
// tc8-firmware-build release asset from GitHub (server-side, dodging the asset's
// missing CORS) and adds `access-control-allow-origin: *` so the cross-origin fetch
// works identically in the browser and the Tauri webview. Cloudflare egress is $0,
// so the multi-GB rootfs streams free. Catch-all route → any tag/asset, no per-
// release config.
//
// Route: GET /artifact/<tag>/<asset>   e.g. /artifact/v0.4.1/rootfs.simg

const REPO = "Polycom-Open-Firmware/tc8-firmware-build";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export async function onRequest({ request, params }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const parts = Array.isArray(params.path) ? params.path : [params.path];
  if (parts.length < 2) {
    return new Response("usage: /artifact/<tag>/<asset>", { status: 400, headers: CORS });
  }
  const asset = parts.pop();
  const tag = parts.join("/");
  if (!/^[\w.+-]+$/.test(asset) || !/^[\w.+-]+$/.test(tag)) {
    return new Response("bad path", { status: 400, headers: CORS });
  }

  const upstream = await fetch(
    `https://github.com/${REPO}/releases/download/${tag}/${asset}`,
    { redirect: "follow" },
  );
  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`upstream ${upstream.status}`, { status: upstream.status, headers: CORS });
  }

  const headers = new Headers(CORS);
  for (const k of ["content-type", "content-length", "accept-ranges", "content-range"]) {
    const v = upstream.headers.get(k);
    if (v) headers.set(k, v);
  }
  headers.set("cache-control", "public, max-age=86400, immutable");
  return new Response(upstream.body, { status: upstream.status, headers });
}
