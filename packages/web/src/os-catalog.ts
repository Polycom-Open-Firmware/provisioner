// SPDX-License-Identifier: GPL-2.0-or-later

// os-catalog.ts — the OS chooser's data + the artifact source, per device.
//
// ONE path for everyone: native AND hosted web fetch through the Cloudflare proxy
// (wizard.openpolycom.cc) — the release list via /releases, the image bytes via
// /artifact/<tag>/<asset>. The proxy streams from GitHub server-side (dodging the
// asset-CORS gap) and sends `access-control-allow-origin: *`, so the cross-origin
// fetch works the same in the browser and the Tauri webview — no parallel paths,
// no native HTTP plugin. Local dev additionally offers the temporary ./artifacts/
// for testing builds that aren't released yet.
//
// Each device draws from its own firmware repo (the proxy keeps the allowlist):
//   tc8 -> /releases            + /artifact/<tag>/<asset>
//   c60 -> /releases?device=c60 + /artifact/c60/<tag>/<asset>
// TC8 releases ship raw images under well-known names, so the TC8 manifests are
// fabricated client-side. C60 releases are manifest-driven: the release carries a
// real `c60-manifest.json` (its bootSeq addresses are build-specific), and the OS
// image set — when present — is that manifest's `os` section.
import type { Artifacts } from "@provisioner/core";
import { isTauri } from "@/native/backend";
import { HttpArtifacts } from "@/artifacts";

// The Cloudflare Pages deployment (serves this SPA + functions/releases +
// functions/artifact). Same-origin for the hosted web app, cross-origin (CORS) for
// native — one path either way.
const PROXY = "https://wizard.openpolycom.cc";

export type DeviceId = "tc8" | "c60";

/** The release asset whose presence marks a build as usable for a device. */
const GATE_ASSET: Record<DeviceId, string> = {
  tc8: "rootfs.simg",
  c60: "c60-manifest.json",
};

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
 * OS builds to offer for a device: its repo's GitHub releases (via the proxy) +
 * the temp one in dev. `fresh` bypasses the proxy's edge cache + the browser
 * cache for an on-demand pull (the chooser's refresh button); normal loads use
 * the cached list.
 */
export async function listOsBuilds(device: DeviceId = "tc8", fresh = false): Promise<OsBuild[]> {
  const builds: OsBuild[] = [];
  if (isLocalDev()) {
    builds.push({ tag: "local", name: "Local dev artifacts", prerelease: false, local: true });
  }
  try {
    const q = new URLSearchParams();
    if (device !== "tc8") q.set("device", device);
    if (fresh) q.set("fresh", "1");
    const qs = q.toString();
    const r = await fetch(`${PROXY}/releases${qs ? `?${qs}` : ""}`, fresh ? { cache: "no-store" } : undefined);
    if (r.ok) {
      const releases = (await r.json()) as Array<{
        tag_name: string;
        name: string | null;
        draft: boolean;
        prerelease: boolean;
        assets: Array<{ name: string }>;
      }>;
      for (const rel of releases) {
        if (rel.draft || !rel.assets?.some((a) => a.name === GATE_ASSET[device])) continue;
        builds.push({ tag: rel.tag_name, name: rel.name || rel.tag_name, prerelease: !!rel.prerelease });
      }
    }
  } catch {
    /* proxy unreachable / offline -> whatever local option we have */
  }
  return builds;
}

/** The Artifacts source for a chosen build of a device. */
export function artifactsFor(build: OsBuild, device: DeviceId = "tc8"): Artifacts {
  return build.local ? new HttpArtifacts("./artifacts/") : new ProxyArtifacts(build.tag, device);
}

// Bytes come from the Cloudflare /artifact proxy. Manifest resolution differs per
// device — TC8 releases ship raw images, so its manifests are fabricated from the
// well-known asset names; C60 releases carry a real c60-manifest.json that this
// source fetches (and answers "os-manifest.json" from its `os` section).
class ProxyArtifacts implements Artifacts {
  constructor(
    private readonly tag: string,
    private readonly device: DeviceId,
  ) {}

  private c60Man: Promise<any> | null = null;

  async manifest(name: string): Promise<any> {
    if (this.device === "c60") {
      if (name === "c60-manifest.json") return this.fetchC60Manifest();
      if (name === "os-manifest.json") {
        const os = (await this.fetchC60Manifest())?.os;
        if (!os) throw new Error(`release ${this.tag} has no C60 OS images (no \`os\` section in c60-manifest.json)`);
        return os;
      }
      throw new Error(`unknown manifest: ${name}`);
    }
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

  private fetchC60Manifest(): Promise<any> {
    // One fetch per run — the unlock step and the install tail share it.
    this.c60Man ??= this.binary("c60-manifest.json").then((b) => JSON.parse(new TextDecoder().decode(b)));
    return this.c60Man;
  }

  async binary(ref: string): Promise<Uint8Array> {
    const f = ref.replace(/^\.?\//, "");
    const dev = this.device === "tc8" ? "" : `${this.device}/`;
    const r = await fetch(`${PROXY}/artifact/${dev}${this.tag}/${f}`);
    if (!r.ok) throw new Error(`fetch ${f}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}
