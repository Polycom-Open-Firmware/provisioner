// Cloudflare Pages Function — the OS list, proxied so every flavor uses the same
// origin and we don't hit GitHub's unauthenticated API rate limit per user (the
// Function's IP makes one cached call). Adds CORS + a short edge cache.
//
// Route: GET /releases  -> tc8-firmware-build's GitHub releases (JSON)

const REPO = "Polycom-Open-Firmware/tc8-firmware-build";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const upstream = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "openpolycom-provisioner" },
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
}
