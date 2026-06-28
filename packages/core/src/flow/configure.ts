// configure.ts — the "Configure" flow. Pushes device configuration to an
// already-unlocked TC8 over fastboot: the operator fills a form, the wizard builds
// a small config blob and flashes it to the stock `cache` GPT partition; a
// boot-time service on the device validates it (magic + sha256) and applies it
// before the kiosk starts. No bootloader change, no re-sign (`cache` is outside
// the AVB-verified chain). Contract: tc8-firmware-build/CONFIG-PARTITION.md.
//
// Blob format (little-endian): magic "TC8CFGv1"(8) | len u32(4) | sha256(32) |
// rsvd(20) | payload(N); payload = UTF-8 "KEY=value\n" lines. Mirrors the
// reference builder tools/mkconfigblob.py.
import type { Flow, FlowContext, FormField } from "../engine/types";

const MAGIC = "TC8CFGv1";

// The implemented (✅) autoconfigure keys, as a form. Blank fields are dropped
// from the payload; unknown/blank keys are safely ignored by the device reader.
const FIELDS: FormField[] = [
  { key: "DEVICE_NAME", label: "Device name (hostname)", placeholder: "lobby-east" },
  { key: "KIOSK_URL", label: "Kiosk URL (web page or rtsp://…)", placeholder: "https://dash.local" },
  { key: "KIOSK_URL_FALLBACK", label: "Fallback URL", placeholder: "https://backup.local" },
  { key: "TIMEZONE", label: "Time zone", placeholder: "America/New_York" },
  { key: "NTP_SERVER", label: "NTP server", placeholder: "192.168.1.1" },
  { key: "VOLUME_MASTER", label: "Master volume (0–100)", placeholder: "80" },
  { key: "ROOT_PASSWORD", label: "root password (change the default!)", secret: true },
  { key: "KIOSK_PASSWORD", label: "kiosk-user password", secret: true },
  { key: "SSH_AUTHKEY", label: "SSH public key (fleet admin access)", placeholder: "ssh-ed25519 AAAA…" },
];

/** Build the config blob from KEY=value pairs (see the format above). */
export async function buildConfigBlob(values: Record<string, string>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const lines = Object.entries(values)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => k + "=" + v);
  const payload = enc.encode(lines.join("\n") + "\n");
  if (payload.byteLength > 1 << 20) throw new Error("config payload exceeds 1 MiB");

  const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  const head = new Uint8Array(64);
  head.set(enc.encode(MAGIC), 0); // magic @0
  new DataView(head.buffer).setUint32(8, payload.byteLength, true); // length LE @8
  head.set(sha, 12); // sha256(payload) @12; reserved @44-63 stays zero

  const blob = new Uint8Array(64 + payload.byteLength);
  blob.set(head, 0);
  blob.set(payload, 64);
  return blob;
}

export function configureFlow(): Flow {
  // Shared, mutable: the form step writes entered values here; the write step reads it.
  const values: Record<string, string> = {};

  return {
    id: "configure",
    title: "Configure",
    summary: "Push settings (hostname, kiosk URL, credentials…) to an unlocked device.",
    steps: [
      {
        id: "intro",
        type: "info",
        rail: "Overview",
        title: "Configure this device",
        body:
          "Set the device's hostname, kiosk URL, credentials and more. The device must already " +
          "be unlocked and running Linux; you'll enter fastboot and the wizard writes the config.",
      },
      {
        id: "settings",
        type: "form",
        rail: "Settings",
        title: "Settings",
        body: "Fill in what you want to set — leave the rest blank. You can change these again later.",
        fields: FIELDS,
        values,
      },
      {
        id: "connect-usb",
        type: "confirm",
        rail: "Connect USB",
        title: "Connect over USB",
        body:
          "When you see the submarine logo, touch the screen with four fingers to enter fastboot. " +
          "Connect the device over USB, then press Continue and choose it from the list.",
        confirmLabel: "Continue",
        gesture: "connect-usb",
      },
      {
        id: "write",
        type: "action",
        rail: "Write config",
        title: "Writing configuration",
        body: "Building the config blob and writing it to the device's cache partition.",
        run: async (ctx: FlowContext) => {
          await ctx.connectUsb();
          const id = await ctx.fb.identify();
          ctx.log("device: " + (id["product"] ?? "?"));
          const blob = await buildConfigBlob(values);
          ctx.log("config blob: " + blob.byteLength + " bytes (" + (blob.byteLength - 64) + " B payload)");
          ctx.log("flashing cache...");
          await ctx.fb.flash("cache", blob, (d, t) => ctx.progress(d, t), (m) => ctx.log("  INFO " + m));
          ctx.log("cache written; rebooting...");
          await ctx.fb.reboot();
          ctx.log("DONE -- device rebooting; the config applies before the kiosk starts.");
        },
      },
      {
        id: "done",
        type: "done",
        rail: "Done",
        title: "Configuration written",
        body: "The device is rebooting and will apply the new settings.",
      },
    ],
  };
}
