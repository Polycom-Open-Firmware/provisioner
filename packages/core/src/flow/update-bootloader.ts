// SPDX-License-Identifier: GPL-2.0-or-later

// update-bootloader.ts — the "Update bootloader" flow (TC8). Stages a new
// stage-2 U-Boot through the `cache` partition: the wizard writes a TC8BOOT1
// blob (header at 1 MiB, image at 1 MiB + 512) over fastboot, and the device's
// boot-time updater flashes it to the eMMC boot1 HW partition — sha256-gated,
// idempotent, recoverable (boot0, the stock stage-1, is never touched).
// Contract: poly-firmware-build/CONFIG-PARTITION.md (bootloader region).
//
// The config blob at offset 0 is a valid no-op, so the device's settings are
// untouched. Entry mirrors Configure: fastboot via the four-finger gesture (or
// `tc8-fastboot` from a shell), then connect over USB.
import type { Flow, FlowContext } from "../engine/types";
import { CONFIG_PARTITION, buildCacheImage } from "../config/blob";
import { ensurePartitionTable, type TableSpec } from "./partitions";

async function fetchStage2(ctx: FlowContext): Promise<Uint8Array> {
  ctx.log("fetching stage-2 manifest");
  const manifest = await ctx.artifacts.manifest("manifest.json");
  const s2 = manifest?.stage2;
  if (!s2 || !s2.url) throw new Error("manifest has no stage2.url");
  const bytes = await ctx.artifacts.binary(s2.url);
  ctx.log("stage-2 binary: " + bytes.byteLength + " bytes");
  // Stage-2 images start with the ARM64 branch instruction 0a 00 00 14 —
  // the same signature the on-device updater checks before flashing.
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0x0a || bytes[1] !== 0x00 || bytes[2] !== 0x00 || bytes[3] !== 0x14
  )
    throw new Error("artifact is not a stage-2 image (bad signature)");
  return bytes;
}

async function runUpdate(ctx: FlowContext, table?: TableSpec): Promise<void> {
  await ctx.connectUsb();

  const id = await ctx.fb.identify();
  ctx.log("device: " + (id["product"] ?? "?") + "   serial=" + (id["serialno"] ?? "?"));
  const info = (m: string) => { try { console.info("[fastboot] " + m); } catch { /* no console */ } };

  // Same GPT guard as Configure: an invalid table means no cache partition to
  // stage into — send the operator to an install instead of writing blind.
  if (table) await ensurePartitionTable(ctx, { fix: false, table });

  const stage2 = await fetchStage2(ctx);
  const image = await buildCacheImage([], stage2);
  ctx.log(
    "cache image: " + image.byteLength + " bytes (no-op config + TC8BOOT1 header + stage-2)",
  );

  ctx.log("flashing " + CONFIG_PARTITION + " (staged bootloader)...");
  await ctx.fb.flash(CONFIG_PARTITION, image, (d, t) => ctx.progress(d, t), info);
  ctx.progress(image.byteLength, image.byteLength);
  ctx.log("  " + CONFIG_PARTITION + " OK");

  // The device applies the staged image on the next boot: the updater verifies
  // the sha256 and only writes boot1 when the image differs. The boot after
  // that runs the new stage-2.
  ctx.log("rebooting — the device flashes the staged bootloader during this boot...");
  await ctx.fb.reboot();
  ctx.log("DONE -- unit rebooting; the new bootloader is active from the following boot.");
}

/** Build the Update-bootloader flow (TC8 — the C60 has no staged-update path). */
export function updateBootloaderFlow(table?: TableSpec): Flow {
  return {
    id: "update-bootloader",
    title: "Update bootloader",
    summary: "Stage a new stage-2 bootloader; the device applies it at boot.",
    steps: [
      {
        id: "apply",
        type: "action",
        rail: "Stage update",
        title: "Stage the bootloader update",
        body:
          "When you see the submarine logo, touch the screen with four fingers to enter fastboot " +
          "(or run tc8-fastboot from a shell on the device). Then connect the device over USB " +
          "and choose it from the list.",
        gesture: "connect-usb",
        confirmLabel: "Connect & update",
        run: (ctx) => runUpdate(ctx, table),
      },
      {
        id: "done",
        type: "done",
        rail: "Done",
        title: "Bootloader staged",
        body:
          "The device is rebooting. It verifies and flashes the new bootloader during this " +
          "boot; the next power cycle runs it.",
      },
    ],
  };
}
