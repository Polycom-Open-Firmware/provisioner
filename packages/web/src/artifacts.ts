// SPDX-License-Identifier: GPL-2.0-or-later

// artifacts.ts — web Artifacts source: fetch manifests + firmware images over
// HTTP, relative to a base URL (default ./artifacts/). The native flavor will
// implement the same interface against the local filesystem / a bundled library.
//
// Per-device manifest semantics mirror the release proxy: TC8 manifests are
// plain files; the C60's single source of truth is c60-manifest.json, and
// "os-manifest.json" is answered from its `os` section — so one local
// artifacts dir serves both devices without name collisions (C60 binaries
// live under a c60/ prefix, referenced by the manifest's relative urls).
import type { Artifacts } from "@provisioner/core";

export class HttpArtifacts implements Artifacts {
  private readonly base: URL;
  private readonly device: string;
  private c60Man: Promise<any> | null = null;

  constructor(baseUrl = "./artifacts/", device = "tc8") {
    this.base = new URL(baseUrl, location.href);
    this.device = device;
  }

  async manifest(name: string): Promise<any> {
    if (this.device === "c60") {
      if (name === "c60-manifest.json") return this.fetchC60Manifest();
      if (name === "os-manifest.json") {
        const os = (await this.fetchC60Manifest())?.os;
        if (!os)
          throw new Error(
            "the local c60-manifest.json has no `os` section — it must list the C60 OS " +
              "image set (boot/dtbo/vbmeta/rootfs with raw partition maps).",
          );
        return os;
      }
      throw new Error(`unknown manifest for the C60: ${name}`);
    }
    return this.fetchJson(name);
  }

  private fetchC60Manifest(): Promise<any> {
    this.c60Man ??= this.fetchJson("c60-manifest.json");
    return this.c60Man;
  }

  private async fetchJson(name: string): Promise<any> {
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
