# Hosting the web flavor on Cloudflare Pages

The in-browser (hosted) flavor needs the firmware images, but GitHub release
assets don't send CORS headers, so a browser can't fetch them cross-origin. The
fix is a **same-origin proxy** that lives next to the SPA: a Cloudflare Pages
Function streams the asset from GitHub, so the browser only ever makes a
same-origin request. Cloudflare bills **$0 for egress**, so even the multi-GB
rootfs is free.

## One-time setup

Connect this repo to **Cloudflare Pages** (dashboard → Workers & Pages → Create →
Pages → connect to Git) with:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | *(repo root)* |
| Build command | `npm ci && npm run build -w @provisioner/web` |
| Build output directory | `packages/web/dist` |

Pages auto-discovers `functions/` at the repo root, so the proxy ships with the
site — no separate Worker, no extra deploy.

## How it serves

- Static SPA → `packages/web/dist` (the Vite build).
- `GET /artifact/<tag>/<asset>` → `functions/artifact/[[path]].js`, which streams
  `github.com/Polycom-Open-Firmware/tc8-firmware-build/releases/download/<tag>/<asset>`
  back with edge caching. Same origin as the SPA ⇒ no CORS.

## Artifact source per flavor

| Flavor | OS list | Image download |
|---|---|---|
| Native (Tauri) | GitHub API | GitHub direct (Rust-side fetch, no CORS) |
| Web — hosted (Pages) | GitHub API | `/artifact/<tag>/<asset>` (this Function) |
| Web — local dev | GitHub API | `./artifacts/` temp files |

The release **list** comes from `api.github.com` (which *is* CORS-enabled) in all
flavors; only the image bytes differ.
