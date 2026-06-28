// reinstall-linux.ts — the "Reinstall Linux" flow (design notes: 4 steps). Loads
// Debian onto an already-unlocked TC8 and reboots into it. Ported from the
// pathfinder `provision-tool/src/flashos.js`: flashes the Android-format slot
// images (boot/dtbo/vbmeta) then the multi-GB rootfs to `userdata` via the
// Android sparse protocol, sets the active slot, and reboots.
import { flashSparse } from "../protocol/sparse";
import type { Flow, FlowContext, Step } from "../engine/types";

const SLOT = "a"; // "replace stock": overwrite boot_a/dtbo_a/vbmeta_a + userdata

async function runFlash(ctx: FlowContext): Promise<void> {
  await ctx.connectUsb();

  // identify — also sets fb.maxDownload, which the sparse splitter needs.
  const id = await ctx.fb.identify();
  ctx.log("device: " + (id["product"] ?? "?") + "   max-download-size=" + (id["max-download-size"] ?? "?"));
  if (!ctx.fb.maxDownload)
    throw new Error("device did not report max-download-size; cannot sparse-flash");

  const man = await ctx.artifacts.manifest("os-manifest.json");

  // small Android images -> boot_<slot> / dtbo_<slot> / vbmeta_<slot>.
  for (const key of ["boot", "dtbo", "vbmeta"] as const) {
    const a = man?.[key];
    if (!a || !a.url) throw new Error("manifest missing " + key + ".url");
    const part = key + "_" + SLOT;
    const data = await ctx.artifacts.binary(a.url);
    ctx.log("flashing " + part + " (" + data.byteLength + " B)...");
    await ctx.fb.flash(part, data, (d, t) => ctx.progress(d, t), (m) => ctx.log("  INFO " + m));
    ctx.log("  " + part + " OK");
  }

  // rootfs -> userdata via Android sparse (resparsed to <= max-download-size).
  const rf = man?.rootfs;
  if (!rf || !rf.url) throw new Error("manifest missing rootfs.url");
  const simg = await ctx.artifacts.binary(rf.url);
  ctx.log("flashing userdata (sparse, " + simg.byteLength + " B sparse image)...");
  await flashSparse(ctx.fb, "userdata", simg, {
    onProgress: (d, t) => ctx.progress(d, t),
    onInfo: (m) => ctx.log("  INFO " + m),
  });
  ctx.log("  userdata OK");

  // make the slot active + reboot into Debian.
  ctx.log("set_active " + SLOT);
  try { await ctx.fb.setActive(SLOT, (m) => ctx.log("  INFO " + m)); }
  catch (e) { ctx.log("  set_active note: " + (e as Error).message); }
  ctx.log("rebooting into Debian...");
  await ctx.fb.reboot();
  ctx.log("DONE -- unit rebooting; boota slot " + SLOT + " -> Debian.");
}

/**
 * The shared OS-install tail: connect to the (stage-2) fastboot gadget, flash the
 * Android-format slot images + sparse rootfs, set the active slot, reboot. Used by
 * BOTH the standalone "Reinstall Linux" flow and the Unlock flow's continuation —
 * so unlocking a fresh unit flows straight into installing the OS (and never sits
 * on the leftover stock Android). `idPrefix` keeps step ids unique when these are
 * appended to another flow; `connectBody` tailors the connect-step copy.
 */
export function osInstallSteps(idPrefix = "os", connectBody?: string): Step[] {
  return [
    {
      id: `${idPrefix}-connect-usb`,
      type: "confirm",
      rail: "USB",
      title: "Connect over USB",
      body: connectBody ?? "With the device in fastboot, pick it from the browser's device list.",
      confirmLabel: "Device connected",
      gesture: "connect-usb",
    },
    {
      id: `${idPrefix}-flash`,
      type: "action",
      rail: "Install",
      title: "Installing Debian",
      body: "Flashing the boot images and the root filesystem. This takes a few minutes.",
      run: runFlash,
    },
    {
      id: `${idPrefix}-done`,
      type: "done",
      rail: "Done",
      title: "Linux installed",
      body: "The device is rebooting into Debian.",
    },
  ];
}

export function reinstallLinuxFlow(): Flow {
  return {
    id: "reinstall-linux",
    title: "Reinstall Linux",
    summary: "Flash a fresh Debian image onto an already-unlocked device.",
    steps: [
      {
        id: "intro",
        type: "info",
        rail: "Intro",
        title: "Reinstall Linux",
        body:
          "This writes a fresh OS image to an already-unlocked device. " +
          "Put the device into fastboot with the four-finger gesture at the boot selector.",
      },
      ...osInstallSteps("os"),
    ],
  };
}
