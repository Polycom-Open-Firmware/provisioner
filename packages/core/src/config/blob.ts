// SPDX-License-Identifier: GPL-2.0-or-later

// blob.ts — build the TC8 autoconfigure "cache" config blob, and hold the
// operator's draft so the UI and the flow share one source of truth.
//
// Contract: tc8-firmware-build/CONFIG-PARTITION.md. The wizard writes this blob to
// the START of the stock `cache` GPT partition over fastboot (`flash cache`); the
// on-device reader (rootfs/etc/tc8-config/apply-config.sh, a oneshot before the
// kiosk) validates magic + sha256 and applies the `KEY=value` lines every boot
// (idempotent). No bootloader change, not AVB-verified. A fresh/empty `cache` or a
// corrupt/half-written blob is ignored, so the device keeps its current config.
//
// Blob layout (little-endian); the header is 64 bytes:
//   off  0   8   magic = ASCII "TC8CFGv1"
//   off  8   4   length = payload byte length (u32 LE)
//   off 12  32   sha256(payload), raw 32 bytes
//   off 44  20   reserved (zero)
//   off 64   N   payload: UTF-8 `KEY=value` lines (LF); `#`/blank lines ignored

/** ASCII magic at offset 0 — the reader gates on this before applying. */
export const CONFIG_MAGIC = "TC8CFGv1";
/** Stock Android GPT partition the blob is written to (1 GiB ext4, unused by Debian). */
export const CONFIG_PARTITION = "cache";
/** The on-device reader rejects payloads larger than this. */
export const CONFIG_MAX_PAYLOAD = 1 << 20; // 1 MiB

/**
 * The v1 config keys the on-device reader applies today (the ✅ rows in
 * CONFIG-PARTITION.md). The wizard may send a superset — the reader logs and
 * ignores unknown keys — but these are the ones that take effect.
 */
export const CONFIG_KEYS = [
  "DEVICE_NAME",
  "KIOSK_URL",
  "KIOSK_URL_FALLBACK",
  "COG_OPTS",
  "TIMEZONE",
  "NTP_SERVER",
  "WIFI_SSID",
  "WIFI_PASSWORD",
  "WIFI_COUNTRY",
  "ROOT_PASSWORD",
  "KIOSK_PASSWORD",
  "SSH_AUTHKEY",
  "CA_CERT_B64",
  "VOLUME_MASTER",
  "VOLUME_SPEAKER",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type ConfigFields = Partial<Record<ConfigKey, string>>;

/**
 * Turn a field map into payload lines. A blank/whitespace-only value is *skipped*
 * (not emitted as `KEY=`) so leaving a field empty is a no-op — the device keeps
 * its current value — rather than clobbering it with an empty string. Any CR/LF in
 * a value is stripped (the payload is strictly one `KEY=value` per line). A leading
 * marker comment makes the blob self-identifying at rest (the reader skips `#`).
 */
export function configFieldsToLines(fields: ConfigFields): string[] {
  const lines = ["# tc8 autoconfigure v1 (written by the provisioner)"];
  // Stamp the FLASH time (epoch seconds) so an offline device with no NTP
  // still boots with a roughly-right clock. The device applies it
  // forward-only (never clobbers a real/NTP-synced time). Fresher than the
  // image build date; see tc8-firmware-build/CONFIG-PARTITION.md (CONFIG_TIME).
  lines.push("CONFIG_TIME=" + Math.floor(Date.now() / 1000));
  for (const key of CONFIG_KEYS) {
    const raw = fields[key];
    if (raw == null || raw.trim() === "") continue;
    lines.push(key + "=" + raw.replace(/[\r\n]/g, ""));
  }
  return lines;
}

/** Build the 64-byte header + payload blob from ready-made `KEY=value` lines. */
export async function buildConfigBlobFromLines(lines: string[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const payload = enc.encode(lines.join("\n") + "\n");
  if (payload.byteLength > CONFIG_MAX_PAYLOAD)
    throw new Error(
      "config payload " + payload.byteLength + " B exceeds the " +
        CONFIG_MAX_PAYLOAD + " B limit",
    );

  const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  const head = new Uint8Array(64);
  head.set(enc.encode(CONFIG_MAGIC), 0); // magic
  new DataView(head.buffer).setUint32(8, payload.byteLength, true); // length LE
  head.set(sha, 12); // sha256(payload)

  const blob = new Uint8Array(head.byteLength + payload.byteLength);
  blob.set(head, 0);
  blob.set(payload, 64);
  return blob;
}

/** Build the blob from a field map (skips blanks; see {@link configFieldsToLines}). */
export function buildConfigBlob(fields: ConfigFields): Promise<Uint8Array> {
  return buildConfigBlobFromLines(configFieldsToLines(fields));
}

// --- bootloader update (rides the same cache write) --------------------------
// Contract: tc8-firmware-build/CONFIG-PARTITION.md (bootloader-update section).
// The wizard never writes the
// eMMC boot1 HW partition directly; it stages the stage-2 image in `cache` (at
// 1 MiB, after the config blob) and the running OS flashes boot1 on the next boot
// (sha256-verified, idempotent, can't brick — boot0 is untouched).

/** ASCII magic at 1 MiB — the on-device updater gates on this; absent → no-op. */
export const BOOTLOADER_MAGIC = "TC8BOOT1";
const BL_HDR_OFFSET = 1 << 20; // 0x100000 — bootloader header sector
const BL_IMG_OFFSET = BL_HDR_OFFSET + 512; // 0x100200 — image, next sector

/**
 * Build the full `cache` image: the config blob at offset 0, and — when `stage2`
 * is supplied — the bootloader update blob (64-byte `TC8BOOT1` header at 1 MiB:
 * magic | len u32 LE | sha256(image) | reserved; the image at 1 MiB + 512). With
 * no `stage2` this is byte-identical to {@link buildConfigBlobFromLines}, so the
 * config-only path is unchanged. The two on-device services read independently —
 * apply-config at offset 0, the bootloader updater at 1 MiB.
 */
export async function buildCacheImage(
  lines: string[],
  stage2?: Uint8Array | null,
): Promise<Uint8Array> {
  const config = await buildConfigBlobFromLines(lines);
  if (!stage2 || stage2.byteLength === 0) return config;
  if (config.byteLength > BL_HDR_OFFSET)
    throw new Error("config blob overlaps the 1 MiB bootloader offset");

  const enc = new TextEncoder();
  const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(stage2)));
  const blHdr = new Uint8Array(64);
  blHdr.set(enc.encode(BOOTLOADER_MAGIC), 0);
  new DataView(blHdr.buffer).setUint32(8, stage2.byteLength, true);
  blHdr.set(sha, 12);

  const buf = new Uint8Array(BL_IMG_OFFSET + stage2.byteLength);
  buf.set(config, 0);
  buf.set(blHdr, BL_HDR_OFFSET);
  buf.set(stage2, BL_IMG_OFFSET);
  return buf;
}

/**
 * Module-singleton config draft. The Configure flow (core) and the operator-input
 * UI (web `ConfigForm`) share this so the flow never imports React and the UI never
 * imports a transport. Defaults are empty → an un-edited Configure writes a valid
 * *no-op* blob and the device keeps every setting.
 */
let draft: ConfigFields = {};

export const configStore = {
  /** A copy of the current field map. */
  snapshot(): ConfigFields {
    return { ...draft };
  },
  /** Merge partial updates. An empty-string value clears that field (→ no-op line). */
  set(patch: ConfigFields): void {
    draft = { ...draft, ...patch };
  },
  /** Clear all fields (back to a no-op blob). */
  reset(): void {
    draft = {};
  },
};
