// SPDX-License-Identifier: GPL-2.0-or-later

// Cloudflare Pages Function — the single artifact path for every flavor. Streams a
// tc8-firmware-build release asset from GitHub (server-side, dodging the asset's
// missing CORS) and adds `access-control-allow-origin: *` so the cross-origin fetch
// works identically in the browser and the Tauri webview. Cloudflare egress is $0,
// so the multi-GB rootfs streams free. Catch-all route → any tag/asset, no per-
// release config.
//
// Route: GET /artifact/<tag>/<asset>            e.g. /artifact/v0.4.1/rootfs.simg
//        GET /artifact/<device>/<tag>/<asset>   e.g. /artifact/c60/v0.1.0/flash.bin
//
// An optional leading device segment selects the source repo from the allowlist;
// without one it's tc8, so clients shipped before the segment existed keep working.

const REPOS = {
  tc8: "Polycom-Open-Firmware/poly-firmware-build",
  c60: "Polycom-Open-Firmware/c60-firmware-build",
};
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export async function onRequest({ request, params }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const repo = parts.length >= 3 && REPOS[parts[0]] ? REPOS[parts.shift()] : REPOS.tc8;
  if (parts.length < 2) {
    return new Response("usage: /artifact/[device/]<tag>/<asset>", { status: 400, headers: CORS });
  }
  const asset = parts.pop();
  const tag = parts.join("/");
  if (!/^[\w.+-]+$/.test(asset) || !/^[\w.+-]+$/.test(tag)) {
    return new Response("bad path", { status: 400, headers: CORS });
  }

  const upstream = await fetch(
    `https://github.com/${repo}/releases/download/${tag}/${asset}`,
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
