// Cloudflare Pages Function — same-origin proxy for tc8-firmware-build release
// assets, so the in-browser (hosted web) flavor can download firmware that GitHub
// release assets otherwise block via CORS. Because this runs on the SAME origin as
// the SPA, the browser does a same-origin request (no CORS involved at all); the
// function fetches from GitHub server-side and STREAMS the bytes back — no
// buffering, so the multi-GB rootfs is fine. Cloudflare bills $0 for egress.
//
// Route: GET /artifact/<tag>/<asset>   e.g. /artifact/v0.4.1/rootfs.simg

const REPO = "Polycom-Open-Firmware/tc8-firmware-build";

export async function onRequest({ params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  if (parts.length < 2) {
    return new Response("usage: /artifact/<tag>/<asset>", { status: 400 });
  }
  const asset = parts.pop();
  const tag = parts.join("/");

  // Only allow plain filenames (no traversal) and a sane tag.
  if (!/^[\w.+-]+$/.test(asset) || !/^[\w.+-]+$/.test(tag)) {
    return new Response("bad path", { status: 400 });
  }

  const upstream = await fetch(
    `https://github.com/${REPO}/releases/download/${tag}/${asset}`,
    { redirect: "follow" },
  );
  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`upstream ${upstream.status}`, { status: upstream.status });
  }

  const headers = new Headers();
  for (const k of ["content-type", "content-length", "accept-ranges", "content-range"]) {
    const v = upstream.headers.get(k);
    if (v) headers.set(k, v);
  }
  // Edge-cache the immutable release asset so repeat flashes don't re-hit GitHub.
  headers.set("cache-control", "public, max-age=86400, immutable");
  return new Response(upstream.body, { status: upstream.status, headers });
}
