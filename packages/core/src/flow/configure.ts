// configure.ts — the "Configure" flow (design notes: the Reconfigure path). Pushes
// device settings to an already-installed TC8 by writing a small config blob to the
// stock `cache` GPT partition over fastboot; a boot-time service on the device
// validates and applies it before the kiosk starts. No bootloader change, not
// AVB-verified. Contract + the full key schema: tc8-firmware-build/CONFIG-PARTITION.md.
//
// Entry mirrors "Reinstall Linux": the unit is already unlocked, so the operator
// does the 4-finger gesture to drop it into fastboot, then connects over USB. The
// operator's field values come from the shared `configStore` (the web `ConfigForm`
// writes them); a field left blank is omitted from the blob and left as-is on the
// device. With no input at all this writes a valid no-op blob.
import type { Flow, FlowContext } from "../engine/types";
import {
  CONFIG_PARTITION,
  buildConfigBlob,
  configFieldsToLines,
  configStore,
} from "../config/blob";
import { ensurePartitionTable } from "./partitions";

async function runApply(ctx: FlowContext): Promise<void> {
  await ctx.connectUsb();

  // identify — confirms we're talking to the unit's fastboot (also sets maxDownload).
  const id = await ctx.fb.identify();
  ctx.log("device: " + (id["product"] ?? "?") + "   serial=" + (id["serialno"] ?? "?"));

  // Don't touch the filesystem if the partition table is borked — refuse and tell
  // the operator to run an install (which repairs it). We do NOT fix here.
  await ensurePartitionTable(ctx, { fix: false });

  // Build the blob from the operator's draft. Blank fields are skipped, so the
  // device keeps its current value for anything left empty.
  const fields = configStore.snapshot();
  const lines = configFieldsToLines(fields);
  const setKeys = lines.filter((l) => !l.startsWith("#")).map((l) => l.split("=")[0] ?? l);
  ctx.log(
    setKeys.length
      ? "applying " + setKeys.length + " setting(s): " + setKeys.join(", ")
      : "no settings supplied — writing a no-op config blob (device keeps its config)",
  );

  const blob = await buildConfigBlob(fields);
  ctx.log(
    "config blob: " + blob.byteLength + " bytes (64 header + " +
      (blob.byteLength - 64) + " payload)",
  );

  ctx.log("flashing " + CONFIG_PARTITION + " (config blob)...");
  await ctx.fb.flash(
    CONFIG_PARTITION,
    blob,
    (d, t) => ctx.progress(d, t),
    (m) => ctx.log("  INFO " + m),
  );
  ctx.progress(blob.byteLength, blob.byteLength);
  ctx.log("  " + CONFIG_PARTITION + " OK");

  // Reboot so the boot-time reader applies the new config.
  ctx.log("rebooting so the device applies the new configuration...");
  await ctx.fb.reboot();
  ctx.log("DONE -- unit rebooting; config applied at boot.");
}

/** Build the Configure flow. */
export function configureFlow(): Flow {
  return {
    id: "configure",
    title: "Configure",
    summary: "Push settings to an already-installed device.",
    steps: [
      {
        id: "intro",
        type: "info",
        rail: "Overview",
        title: "Configure this device",
        body:
          "Push settings — name, kiosk URL, time zone, access — to a device that's already " +
          "running Linux. The device applies them on its next boot. Takes about a minute.",
      },
      {
        id: "settings",
        type: "confirm",
        rail: "Settings",
        title: "Choose what to apply",
        body:
          "Set the values you want to change. Anything you leave blank is kept as-is on the " +
          "device. When you're ready, press Continue.",
        confirmLabel: "Continue",
      },
      {
        id: "connect-usb",
        type: "confirm",
        rail: "Connect USB",
        title: "Put the device into fastboot, then connect",
        body:
          "When you see the submarine logo, touch the screen with four fingers to enter fastboot. " +
          "Then connect the device to this computer over USB, press Continue, and choose it from the list.",
        confirmLabel: "Continue",
        gesture: "connect-usb",
      },
      {
        id: "apply",
        type: "action",
        rail: "Apply config",
        title: "Applying configuration",
        body: "Writing the configuration to the device and rebooting.",
        run: runApply,
      },
      {
        id: "done",
        type: "done",
        rail: "Done",
        title: "Configuration applied",
        body: "The device is rebooting with the new settings.",
      },
    ],
  };
}
