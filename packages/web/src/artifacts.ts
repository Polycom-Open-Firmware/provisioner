// artifacts.ts — web Artifacts source: fetch manifests + firmware images over
// HTTP, relative to a base URL (default ./artifacts/). The native flavor will
// implement the same interface against the local filesystem / a bundled library.
import type { Artifacts } from "@provisioner/core";

export class HttpArtifacts implements Artifacts {
  private readonly base: URL;

  constructor(baseUrl = "./artifacts/") {
    this.base = new URL(baseUrl, location.href);
  }

  async manifest(name: string): Promise<any> {
    const url = new URL(name, this.base).href;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("manifest fetch failed: HTTP " + r.status + " " + url);
    this.lastManifest = url;
    return r.json();
  }

  // Resolve binary refs relative to the most recently fetched manifest so a
  // manifest can move (HTTP path / release asset) and its relative urls follow.
  private lastManifest: string | null = null;

  async binary(ref: string): Promise<Uint8Array> {
    const baseFor = this.lastManifest ? new URL(this.lastManifest) : this.base;
    const url = new URL(ref, baseFor).href;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("artifact fetch failed: HTTP " + r.status + " " + url);
    return new Uint8Array(await r.arrayBuffer());
  }
}
