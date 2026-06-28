// os-catalog.ts — the OS chooser's data + the per-flavor artifact source.
//
// The OS list comes from tc8-firmware-build's GitHub releases (the API IS
// CORS-enabled, so it works in every flavor). The image bytes differ by flavor:
//   - native (Tauri): GitHub release asset, fetched Rust-side (no CORS)
//   - web hosted:     same-origin /artifact/<tag>/<asset> Cloudflare Pages fn
//   - web local dev:  the temporary ./artifacts/ files
import type { Artifacts } from "@provisioner/core";
import { isTauri } from "@/native/backend";
import { HttpArtifacts } from "@/artifacts";

const REPO = "Polycom-Open-Firmware/tc8-firmware-build";
// The asset names a release must carry to be a flashable OS build.
const REQUIRED_ASSET = "rootfs.simg";

export type Env = "native" | "web-hosted" | "web-local";

export function currentEnv(): Env {
  if (isTauri()) return "native";
  const h = typeof location !== "undefined" ? location.hostname : "";
  return h === "localhost" || h === "127.0.0.1" || h === "" ? "web-local" : "web-hosted";
}

export interface OsBuild {
  tag: string;
  name: string;
  prerelease: boolean;
  /** The local dev "temporary artifacts" pseudo-build. */
  local?: boolean;
}

/** OS builds to offer. */
export async function listOsBuilds(): Promise<OsBuild[]> {
  // Self-hosted debug build: keep serving the temporary local ./artifacts/ as
  // before (the GitHub release assets would be CORS-blocked here anyway).
  if (currentEnv() === "web-local") {
    return [{ tag: "local", name: "Local dev artifacts", prerelease: false, local: true }];
  }
  // Native / hosted web: GitHub releases (their assets ARE fetchable in these flavors).
  const builds: OsBuild[] = [];
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (r.ok) {
      const releases = (await r.json()) as Array<{
        tag_name: string;
        name: string | null;
        draft: boolean;
        prerelease: boolean;
        assets: Array<{ name: string }>;
      }>;
      for (const rel of releases) {
        if (rel.draft || !rel.assets?.some((a) => a.name === REQUIRED_ASSET)) continue;
        builds.push({ tag: rel.tag_name, name: rel.name || rel.tag_name, prerelease: !!rel.prerelease });
      }
    }
  } catch {
    /* offline / API error -> whatever local option we have */
  }
  return builds;
}

/** The Artifacts source for a chosen build. */
export function artifactsFor(build: OsBuild): Artifacts {
  return build.local ? new HttpArtifacts("./artifacts/") : new GithubArtifacts(build.tag);
}

// Synthetic manifests — the releases ship raw images, not manifest JSON, so we
// map the well-known asset names to the flash targets here.
class GithubArtifacts implements Artifacts {
  private readonly env = currentEnv();
  constructor(private readonly tag: string) {}

  private assetUrl(name: string): string {
    const f = name.replace(/^\.?\//, "");
    if (this.env === "web-hosted") return `/artifact/${this.tag}/${f}`;
    return `https://github.com/${REPO}/releases/download/${this.tag}/${f}`;
  }

  private async get(name: string): Promise<Uint8Array> {
    const url = this.assetUrl(name);
    // Native bypasses the webview's CORS via the Tauri HTTP layer (Rust-side).
    const doFetch =
      this.env === "native" ? (await import("@tauri-apps/plugin-http")).fetch : fetch;
    const r = await doFetch(url);
    if (!r.ok) throw new Error(`fetch ${name}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

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
    return this.get(ref);
  }
}
