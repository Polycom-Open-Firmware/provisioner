# Hosting the web flavor — CORS, the proxy, and Cloudflare Pages

## The problem

The wizard flashes firmware that lives as **GitHub release assets** on
`Polycom-Open-Firmware/poly-firmware-build`. Those asset downloads send **no
`access-control-allow-origin` header**, so a browser can't fetch them
cross-origin. The in-browser flavor needs a same-origin source for the bytes;
unauthenticated `api.github.com` calls also rate-limit unpredictably, so the
release list is proxied too.

## How the app gets its artifacts

One path for every flavor: the release list comes from the `/releases` Pages
Function (an edge-cached GitHub proxy) and the image bytes from same-origin
`/artifact/<tag>/<asset>` — both served by the Cloudflare deployment. The
native flavor points at the same hosted endpoints. In local dev the bytes
come from `packages/web/public/artifacts/` (same-origin localhost).

`packages/web/src/os-catalog.ts` picks the byte source from the runtime
environment; the OS chooser lists releases via the `/releases` Function in
every flavor.

## The proxy — a streaming, same-origin **proxy** (not a redirect)

`functions/artifact/[[path]].js` is a Cloudflare Pages Function on a **catch-all**
route. The browser requests it on the **same origin** as the SPA, so CORS never
applies; the Function fetches the asset from GitHub server-side and **streams the
bytes back** (no buffering — the multi-GB rootfs is fine):

```
browser → wizard.openpolycom.cc/artifact/<tag>/<asset>
            → Function fetch()s github.com/.../releases/download/<tag>/<asset>
            → pipes the response body back, same origin
```

A *redirect* would not work — it would bounce the browser to GitHub and hit the
CORS wall again. This is a true proxy.

### Multiple firmware repos (per-device)

Each device draws from its own firmware repo, selected by a small allowlist in
the Functions (one entry per device, nothing else proxied):

- `/releases` and `/artifact/<tag>/<asset>` → `poly-firmware-build` (the
  default, so clients shipped before the device key existed keep working)
- `/releases?device=c60` and `/artifact/c60/<tag>/<asset>` → the C60 firmware
  repo

### New releases need zero work here

The route is parameterized (`[[path]]` = `<tag>/<asset>`), so it resolves any tag
on the fly. Tag a new firmware release on GitHub and:
- it auto-appears in the OS chooser (the `/releases` Function queries GitHub
  live, with a short edge cache), and
- it flashes through the same proxy unchanged.

No new proxy entry, no redeploy. The only things that would ever need a code
change: adding or switching a firmware **repo** (the allowlist map in both
Functions) or **renaming** the standard TC8 assets (`rootfs.simg`/`boot.img`/
`dtbo.img`/`vbmeta.img`/`tc8-stage2-uboot.bin`) — neither happens on a normal
release. C60 releases are manifest-driven (`c60-manifest.json` names its own
assets), so C60 asset names can change freely.

## One-time setup

### 1. Cloudflare account + domain
- Sign up at dash.cloudflare.com (free).
- **Add a domain** → `openpolycom.cc` → Free plan → set the two Cloudflare
  nameservers it shows you (at your registrar). Wait for the zone to go
  **Active**.
- Delete any imported **parking record** (`A @ → <registrar parking IP>`) — it
  otherwise keeps the domain on the parked page.

### 2. Pages project (direct upload, deployed from GitHub Actions)
Workers & Pages → Create → Pages → **Direct Upload** → project name
`provisioner`. The project is **not** connected to Git — a push does not
deploy by itself.

Deploys run from GitHub Actions instead: on push to `main`,
`.github/workflows/deploy.yml` builds the SPA
(`npm ci && npm run build -w @provisioner/web`) and publishes
`packages/web/dist` with `wrangler pages deploy`. It needs the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets. The
`functions/` directory at the repo root ships with each deploy, so the proxy
travels with the site. You get a `*.pages.dev` URL on the first deploy.

### 3. Custom domain
Pages project → **Custom domains** → add `wizard.openpolycom.cc`. Since the
zone is on Cloudflare it creates the proxied `CNAME → *.pages.dev` for you and
provisions TLS. (Manual equivalent: `CNAME @ → <project>.pages.dev`, Proxied.)

## Cost and limits

- **Function requests: 100,000 a day** (Pages Functions run on the Workers free
  tier; resets daily). Static SPA serving is unlimited and free. About five
  Function hits per full flash (one per asset) — roughly 20,000 flashes a day
  of headroom.
- **Egress bandwidth: $0, unmetered** across Cloudflare (CDN/Workers/Pages/R2).
  The big rootfs streams cost nothing.
- **CPU: 10 ms/invocation** — irrelevant for an I/O-bound streaming proxy.
- If you ever exceed it: Workers Paid is **$5/mo for 10M requests/mo**, egress
  still $0.

## Scaling later (optional)

Two refinements if download volume ever gets heavy:
- **Edge-cache repeats:** add Cloudflare's Cache API inside the Function (~3 lines)
  so repeat downloads serve from the edge and don't count as invocations.
- **R2 for the bytes:** Cloudflare's free-plan ToS (§2.8) discourages using the
  generic CDN *primarily* as a large-file mirror. If `/artifact` became
  high-traffic, mirror the images into **R2** (zero egress by design, 10 GB free,
  purpose-built for this) and point the Function/app at the bucket. Still $0
  bandwidth.
