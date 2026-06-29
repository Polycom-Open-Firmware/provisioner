// SPDX-License-Identifier: GPL-2.0-or-later

// os-catalog.ts — the OS chooser's data + the artifact source.
//
// ONE path for everyone: native AND hosted web fetch through the Cloudflare proxy
// (openpolycom.cc) — the release list via /releases, the image bytes via
// /artifact/<tag>/<asset>. The proxy streams from GitHub server-side (dodging the
// asset-CORS gap) and sends `access-control-allow-origin: *`, so the cross-origin
// fetch works the same in the browser and the Tauri webview — no parallel paths,
// no native HTTP plugin. Local dev additionally offers the temporary ./artifacts/
// for testing builds that aren't released yet.
import type { Artifacts } from "@provisioner/core";
import { isTauri } from "@/native/backend";
import { HttpArtifacts } from "@/artifacts";

// The Cloudflare Pages deployment (serves this SPA + functions/releases +
// functions/artifact). Same-origin for the hosted web app, cross-origin (CORS) for
// native — one path either way.
const PROXY = "https://wizard.openpolycom.cc";

export interface OsBuild {
  tag: string;
  name: string;
  prerelease: boolean;
  /** The local dev "temporary artifacts" pseudo-build. */
  local?: boolean;
}

function isLocalDev(): boolean {
  if (isTauri()) return false;
  const h = typeof location !== "undefined" ? location.hostname : "";
  return h === "localhost" || h === "127.0.0.1" || h === "";
}

/**
 * OS builds to offer: the GitHub releases (via the proxy) + the temp one in dev.
 * `fresh` bypasses the proxy's edge cache + the browser cache for an on-demand
 * pull (the chooser's refresh button); normal loads use the cached list.
 */
export async function listOsBuilds(fresh = false): Promise<OsBuild[]> {
  const builds: OsBuild[] = [];
  if (isLocalDev()) {
    builds.push({ tag: "local", name: "Local dev artifacts", prerelease: false, local: true });
  }
  try {
    const r = await fetch(`${PROXY}/releases${fresh ? "?fresh=1" : ""}`, fresh ? { cache: "no-store" } : undefined);
    if (r.ok) {
      const releases = (await r.json()) as Array<{
        tag_name: string;
        name: string | null;
        draft: boolean;
        prerelease: boolean;
        assets: Array<{ name: string }>;
      }>;
      for (const rel of releases) {
        if (rel.draft || !rel.assets?.some((a) => a.name === "rootfs.simg")) continue;
        builds.push({ tag: rel.tag_name, name: rel.name || rel.tag_name, prerelease: !!rel.prerelease });
      }
    }
  } catch {
    /* proxy unreachable / offline -> whatever local option we have */
  }
  return builds;
}

/** The Artifacts source for a chosen build. */
export function artifactsFor(build: OsBuild): Artifacts {
  return build.local ? new HttpArtifacts("./artifacts/") : new ProxyArtifacts(build.tag);
}

// The releases ship raw images, not manifest JSON, so map the well-known asset
// names to flash targets here; bytes come from the Cloudflare /artifact proxy.
class ProxyArtifacts implements Artifacts {
  constructor(private readonly tag: string) {}

  async manifest(name: string): Promise<any> {
    if (name === "manifest.json") return { stage2: { url: "tc8-stage2-uboot.bin" } };
    if (name === "os-manifest.json")
      return {
        boot: { url: "boot.img" },
        dtbo: { url: "dtbo.img" },
        vbmeta: { url: "vbmeta.img" },
        rootfs: { url: "rootfs.simg" },
      };
    throw new Error(`unknown manifest: ${name}`);
  }

  async binary(ref: string): Promise<Uint8Array> {
    const f = ref.replace(/^\.?\//, "");
    const r = await fetch(`${PROXY}/artifact/${this.tag}/${f}`);
    if (!r.ok) throw new Error(`fetch ${f}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}
