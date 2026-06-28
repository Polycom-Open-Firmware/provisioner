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
    if (!r.ok)
      throw new Error(`no manifest at ${url} (HTTP ${r.status}). Put it in packages/web/public/artifacts/.`);
    const text = await r.text();
    this.lastManifest = url;
    try {
      return JSON.parse(text);
    } catch {
      // A dev server returns its HTML index for unknown paths (HTTP 200), so a
      // missing manifest reads as "<!doctype …>" — make that legible.
      const head = text.slice(0, 32).replace(/\s+/g, " ");
      throw new Error(
        `manifest at ${url} isn't JSON (got "${head}…"). The file is probably missing — ` +
          `add it under packages/web/public/artifacts/.`,
      );
    }
  }

  // Resolve binary refs relative to the most recently fetched manifest so a
  // manifest can move (HTTP path / release asset) and its relative urls follow.
  private lastManifest: string | null = null;

  async binary(ref: string): Promise<Uint8Array> {
    const baseFor = this.lastManifest ? new URL(this.lastManifest) : this.base;
    const url = new URL(ref, baseFor).href;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok)
      throw new Error(`artifact not found: ${url} (HTTP ${r.status}). Put it in packages/web/public/artifacts/.`);
    if ((r.headers.get("content-type") ?? "").includes("text/html"))
      throw new Error(`artifact ${url} returned HTML (dev-server fallback) — the file is missing from packages/web/public/artifacts/.`);
    return new Uint8Array(await r.arrayBuffer());
  }
}
