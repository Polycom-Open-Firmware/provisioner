// SPDX-License-Identifier: GPL-2.0-or-later

// app-versions.ts — the archive's published version per application package,
// for the Application tiles' version badges. The apt archive only publishes
// the latest version of a package, so this map IS "latest". Fetched once per
// session (module-cached): same-origin /apps on the hosted wizard, falling
// back to the deployed proxy (CORS *) so local dev gets badges too. Any
// failure resolves to an empty map — tiles simply render without badges.
const PROXY = "https://wizard.openpolycom.cc";

let cached: Promise<Record<string, string>> | null = null;

async function fetchFrom(base: string): Promise<Record<string, string>> {
  const r = await fetch(base + "/apps");
  if (!r.ok) throw new Error(String(r.status));
  const apps = (await r.json()) as Array<{ name: string; version: string }>;
  const map: Record<string, string> = {};
  for (const a of apps) if (a.name && a.version) map[a.name] = a.version;
  return map;
}

export function getAppVersions(): Promise<Record<string, string>> {
  if (!cached)
    cached = fetchFrom("")
      .catch(() => fetchFrom(PROXY))
      .catch(() => ({}));
  return cached;
}
