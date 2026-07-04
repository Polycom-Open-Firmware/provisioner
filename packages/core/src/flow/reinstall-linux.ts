// SPDX-License-Identifier: GPL-2.0-or-later

// reinstall-linux.ts — the "Reinstall Linux" flow (design notes: 4 steps). Loads
// Debian onto an already-unlocked device and reboots into it. Ported from the
// pathfinder `provision-tool/src/flashos.js`: flashes the Android-format slot
// images (boot/dtbo/vbmeta) then the multi-GB rootfs — to the manifest's
// rootfs target (`userdata` on TC8, `system_a` on C60) — via the Android
// sparse protocol, sets the active slot, and reboots.
import { flashSparse, parseSparse, planResparse } from "../protocol/sparse";
import type { Flow, FlowContext, Step } from "../engine/types";
import {
  CONFIG_PARTITION,
  buildConfigBlob,
  configFieldsToLines,
  configStore,
} from "../config/blob";
import { TC8_TABLE, ensurePartitionTable } from "./partitions";

const SLOT = "a"; // "replace stock": overwrite boot_a/dtbo_a/vbmeta_a + the rootfs

async function runFlash(ctx: FlowContext): Promise<void> {
  await ctx.connectUsb();

  // identify — also sets fb.maxDownload, which the sparse splitter needs.
  const id = await ctx.fb.identify();
  ctx.log("device: " + (id["product"] ?? "?") + "   max-download-size=" + (id["max-download-size"] ?? "?"));
  if (!ctx.fb.maxDownload)
    throw new Error("device did not report max-download-size; cannot sparse-flash");

  const man = await ctx.artifacts.manifest("os-manifest.json");
  const rf = man?.rootfs;
  if (!rf || !rf.url) throw new Error("manifest missing rootfs.url");
  // TC8 manifests carry no `target` (rootfs → userdata); the C60's says system_a.
  const rootfsTarget: string = rf.target ?? "userdata";

  // Repair the partition table first if it's been nuked — no serial, no brick.
  // What "intact" means comes from the manifest: `gptRestore` absent = a TC8-era
  // manifest (default TC8 restore image); null = no restore image exists (C60 —
  // the stock table is assumed intact); an object names the image.
  await ensurePartitionTable(ctx, {
    fix: true,
    table: {
      required: [rootfsTarget, "boot_" + SLOT],
      restore:
        man.gptRestore === undefined
          ? TC8_TABLE.restore
          : man.gptRestore
            ? { image: man.gptRestore.url, diskSectors: man.gptRestore.diskSectors }
            : null,
    },
  });

  // Fetch every artifact up front so the progress bar can run ONE 0→100 % across
  // the whole install (the small slot images + the multi-GB rootfs), weighted by
  // bytes — instead of resetting per partition.
  const small: { part: string; data: Uint8Array }[] = [];
  for (const key of ["boot", "dtbo", "vbmeta"] as const) {
    const a = man?.[key];
    if (!a || !a.url) throw new Error("manifest missing " + key + ".url");
    small.push({ part: a.target ?? key + "_" + SLOT, data: await ctx.artifacts.binary(a.url) });
  }
  const simg = await ctx.artifacts.binary(rf.url);

  // Materialized sparse byte count — the unit flashSparse reports progress in — so
  // every contribution to the bar is in the same currency.
  const sparseTotal = planResparse(parseSparse(simg), ctx.fb.maxDownload).subimages.reduce(
    (a, s) => a + s.size,
    0,
  );
  const grandTotal = small.reduce((a, s) => a + s.data.byteLength, 0) + sparseTotal;
  // fastboot INFO lines are verbose — send them to the dev console, not the
  // operator-facing Status Log.
  const info = (m: string) => { try { console.info("[fastboot] " + m); } catch { /* no console */ } };
  let base = 0;

  for (const s of small) {
    ctx.log("flashing " + s.part + " (" + s.data.byteLength + " B)...");
    await ctx.fb.flash(s.part, s.data, (d) => ctx.progress(base + d, grandTotal), info);
    base += s.data.byteLength;
    ctx.progress(base, grandTotal);
    ctx.log("  " + s.part + " OK");
  }

  ctx.log("flashing " + rootfsTarget + " (sparse, " + simg.byteLength + " B sparse image)...");
  await flashSparse(ctx.fb, rootfsTarget, simg, {
    onProgress: (d) => ctx.progress(base + d, grandTotal),
    onInfo: info,
  });
  base += sparseTotal;
  ctx.progress(grandTotal, grandTotal);
  ctx.log("  " + rootfsTarget + " OK");

  // If the operator supplied settings (the Unlock flow's config page), write the
  // config blob to the `cache` partition in this same fastboot session so the
  // boot-time reader applies it on first boot — no second fastboot trip. The
  // standalone Reinstall flow has no config page, so the store is empty there and
  // this is skipped. Blank fields are omitted from the blob (defaults kept).
  const cfgFields = configStore.snapshot();
  const cfgKeys = configFieldsToLines(cfgFields).filter((l) => !l.startsWith("#"));
  if (cfgKeys.length) {
    const blob = await buildConfigBlob(cfgFields);
    ctx.log(
      "flashing " + CONFIG_PARTITION + " config blob (" + blob.byteLength + " B, " +
        cfgKeys.length + " setting(s))...",
    );
    await ctx.fb.flash(CONFIG_PARTITION, blob, undefined, info);
    ctx.log("  " + CONFIG_PARTITION + " OK");
  }

  // make the slot active + reboot into Debian.
  ctx.log("set_active " + SLOT);
  try { await ctx.fb.setActive(SLOT, info); }
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
      id: `${idPrefix}-flash`,
      type: "action",
      rail: "Install Linux",
      title: "Install Linux",
      body:
        connectBody ??
        "Connect the device over USB and choose it from the list to begin. This takes a few minutes.",
      gesture: "connect-usb",
      confirmLabel: "Connect & install",
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

/** OS-build chooser (OS only) — the UI renders the catalog for step id "choose-os". */
export function chooseOsStep(): Step {
  return {
    id: "choose-os",
    type: "confirm",
    rail: "Choose OS",
    title: "Choose an OS",
    body: "Pick which OS build to install. The newest releases are listed first.",
    confirmLabel: "Continue",
  };
}

/** Combined Setup step (OS build + settings) — the UI renders both the catalog and
 *  the config form for step id "setup". Replaces the old separate choose-OS +
 *  settings screens on flows that install AND configure. */
export function setupStep(): Step {
  return {
    id: "setup",
    type: "confirm",
    rail: "Setup",
    title: "Set up this device",
    body:
      "Pick the OS build to install, and set any values you want applied on first boot — " +
      "anything left blank keeps its default.",
    confirmLabel: "Continue",
  };
}

export function reinstallLinuxFlow(): Flow {
  return {
    id: "reinstall-linux",
    title: "Install or Update OS",
    summary: "Flash a fresh Debian image onto an already-unlocked device.",
    steps: [
      chooseOsStep(),
      ...osInstallSteps(
        "os",
        "When you see the submarine logo, touch the screen with four fingers to enter fastboot. " +
          "Then connect the device over USB and choose it from the list to begin.",
      ),
    ],
  };
}
