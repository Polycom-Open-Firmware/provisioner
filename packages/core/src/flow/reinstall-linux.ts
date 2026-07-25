// SPDX-License-Identifier: GPL-2.0-or-later

// reinstall-linux.ts — the "Reinstall Linux" flow (design notes: 4 steps). Loads
// Debian onto an already-unlocked device and reboots into it. Ported from the
// pathfinder `provision-tool/src/flashos.js`: flashes the Android-format slot
// images (boot/dtbo/vbmeta) then the multi-GB rootfs — to the manifest's
// rootfs target (`userdata` on TC8, `system_a` on C60) — via the Android
// sparse protocol, sets the active slot, and reboots.
import { flashSparse, parseSparse, planResparse } from "../protocol/sparse";
import type { DangerGate, Flow, FlowContext, Step } from "../engine/types";
import {
  CONFIG_PARTITION,
  buildConfigBlob,
  configFieldsToLines,
  configStore,
} from "../config/blob";
import { ensurePartitionTable, type TableSpec } from "./partitions";
import { settingsSteps, type SettingsSection } from "./settings";

const SLOT = "a"; // "replace stock": overwrite boot_a/dtbo_a/vbmeta_a + the rootfs
const C60_FASTBOOT_BUF_ADDR = 0x42800000; // CONFIG_FASTBOOT_BUF_ADDR — where download lands

interface InstallOptions {
  /** C60 only: persist the SDP-loaded open U-Boot into the eMMC boot area. */
  replaceBootloader?: boolean;
  /** Raw config-blob target for devices with no named `cache` partition
   *  (the C60): the install-tail settings write and Configure share it. */
  rawConfig?: RawPartitionSpec;
  /** The device's GPT contract. A TableSpec enables the name-probe + repair
   *  path with that device's restore image. `null` = the device installs via
   *  a manifest raw partition map only — no name-probe, and a manifest
   *  without a raw map is refused outright. Omitted = no repair capability
   *  (probe against the manifest's own gptRestore only). */
  table?: TableSpec | null;
}

interface RawPartitionSpec {
  startLBA: number;
  sizeLBA: number;
}

interface ManifestArtifact {
  url?: string;
  target?: string;
  raw?: RawPartitionSpec;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function replaceC60Bootloader(ctx: FlowContext, info: (msg: string) => void): Promise<void> {
  const man = await ctx.artifacts.manifest("c60-manifest.json");
  const fb = man?.flashbin;
  if (!fb || !fb.url) throw new Error("c60 manifest has no flashbin.url");

  const image = await ctx.artifacts.binary(fb.url);
  if (typeof fb.size === "number" && fb.size !== image.byteLength)
    throw new Error("c60 flash.bin size mismatch: manifest " + fb.size + " B, artifact " + image.byteLength + " B");
  if (typeof fb.sha256 === "string") {
    const got = await sha256Hex(image);
    if (got !== fb.sha256.toLowerCase())
      throw new Error("c60 flash.bin sha256 mismatch: manifest " + fb.sha256 + ", got " + got);
  }

  ctx.log("persisting C60 open bootloader to eMMC boot area (" + image.byteLength + " B)...");
  // NXP/FSL fastboot predefines this as bootloader0 on A/B builds, bootloader otherwise.
  try {
    await ctx.fb.flash("bootloader0", image, undefined, info);
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes("partition does not exist")) throw e;
    ctx.log("  bootloader0 missing; retrying bootloader");
    await ctx.fb.flash("bootloader", image, undefined, info);
  }
  ctx.log("  C60 bootloader persisted");
}

async function runFlash(ctx: FlowContext, opts: InstallOptions = {}): Promise<void> {
  await ctx.connectUsb();

  // identify — also sets fb.maxDownload, which the sparse splitter needs.
  const id = await ctx.fb.identify();
  ctx.log("device: " + (id["product"] ?? "?") + "   max-download-size=" + (id["max-download-size"] ?? "?"));
  if (!ctx.fb.maxDownload)
    throw new Error("device did not report max-download-size; cannot sparse-flash");

  const man = await ctx.artifacts.manifest("os-manifest.json");
  const rf = man?.rootfs as ManifestArtifact | undefined;
  if (!rf || !rf.url) throw new Error("manifest missing rootfs.url");
  // TC8 manifests carry no `target` (rootfs → userdata); the C60's says system_a.
  const rootfsTarget: string = rf.target ?? "userdata";

  // fastboot INFO lines are verbose — send them to the dev console, not the
  // operator-facing Status Log.
  const info = (m: string) => { try { console.info("[fastboot] " + m); } catch { /* no console */ } };

  const smallDefs = (["boot", "dtbo", "vbmeta"] as const).map((key) => {
    const entry = man?.[key] as ManifestArtifact | undefined;
    if (!entry || !entry.url) throw new Error("manifest missing " + key + ".url");
    return { key, entry, part: entry.target ?? key + "_" + SLOT };
  });
  const rawDefs = [...smallDefs.map((d) => ({ part: d.part, raw: d.entry.raw })), { part: rootfsTarget, raw: rf.raw }];
  const hasRawInstallMap = rawDefs.every((d) => d.raw);

  if (hasRawInstallMap) {
    ctx.log("defining C60 raw fastboot partitions from manifest...");
    for (const d of rawDefs) {
      await ctx.fb.defineRawPartition(d.part, d.raw!.startLBA, d.raw!.sizeLBA, info);
      ctx.log("  " + d.part + " = 0x" + d.raw!.startLBA.toString(16) + "+0x" + d.raw!.sizeLBA.toString(16));
    }
  }

  if (opts?.table === null) {
    // Raw-map-only device (C60): the GPT-name probe is unreliable on its
    // fastboot and no repair image exists for it, so a manifest without a
    // complete raw partition map is refused rather than name-probed — a
    // TC8-shaped manifest selected by mistake must not get near this disk.
    if (!hasRawInstallMap)
      throw new Error(
        "This device installs via the manifest's raw partition map, and the selected " +
          "build has none — wrong or incomplete artifact set for this device.",
      );
    ctx.log("using manifest raw partition map; skipping GPT-name probe.");
  } else if (hasRawInstallMap && man.gptRestore === null) {
    ctx.log("using manifest raw partition map; skipping GPT-name probe.");
  } else {
    // Repair the partition table first if it's been nuked — no serial, no brick.
    // The restore image comes from the manifest (`gptRestore` names it;
    // null = none exists); a manifest without the key falls back to the
    // device profile's table.
    await ensurePartitionTable(ctx, {
      fix: true,
      table: {
        required: [rootfsTarget, "boot_" + SLOT],
        restore:
          man.gptRestore === undefined
            ? (opts?.table?.restore ?? null)
            : man.gptRestore
              ? { image: man.gptRestore.url, diskSectors: man.gptRestore.diskSectors }
              : null,
      },
    });
  }

  // Fetch every artifact up front so the progress bar can run ONE 0→100 % across
  // the whole install (the small slot images + the multi-GB rootfs), weighted by
  // bytes — instead of resetting per partition.
  const small: { part: string; data: Uint8Array }[] = [];
  for (const d of smallDefs) {
    small.push({ part: d.part, data: await ctx.artifacts.binary(d.entry.url!) });
  }
  const simg = await ctx.artifacts.binary(rf.url);

  // Materialized sparse byte count — the unit flashSparse reports progress in — so
  // every contribution to the bar is in the same currency.
  const sparseTotal = planResparse(parseSparse(simg), ctx.fb.maxDownload).subimages.reduce(
    (a, s) => a + s.size,
    0,
  );
  const grandTotal = small.reduce((a, s) => a + s.data.byteLength, 0) + sparseTotal;
  let base = 0;

  if (opts.replaceBootloader) await replaceC60Bootloader(ctx, info);

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
    if (opts.rawConfig) {
      // No named config partition on this device (the C60 GPT has no `cache`);
      // the blob goes to the device's raw config region by direct mmc write —
      // the same download + UCmd path the Configure flow uses (the fastboot
      // name lookup only resolves GPT entries on this u-boot).
      const blockSize = 512;
      const padded = new Uint8Array(Math.ceil(blob.byteLength / blockSize) * blockSize);
      padded.set(blob);
      const blocks = padded.byteLength / blockSize;
      ctx.log(
        "writing config blob to raw LBA 0x" + opts.rawConfig.startLBA.toString(16) +
          " (" + blob.byteLength + " B, " + cfgKeys.length + " setting(s))...",
      );
      await ctx.fb.download(padded);
      await ctx.fb.ucmd("mmc dev 0 0", info);
      await ctx.fb.ucmd(
        "mmc write 0x" + C60_FASTBOOT_BUF_ADDR.toString(16) + " 0x" +
          opts.rawConfig.startLBA.toString(16) + " 0x" + blocks.toString(16),
        info,
      );
      ctx.log("  config blob OK");
    } else {
      ctx.log(
        "flashing " + CONFIG_PARTITION + " config blob (" + blob.byteLength + " B, " +
          cfgKeys.length + " setting(s))...",
      );
      await ctx.fb.flash(CONFIG_PARTITION, blob, undefined, info);
      ctx.log("  " + CONFIG_PARTITION + " OK");
    }
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
export function osInstallSteps(
  idPrefix = "os",
  connectBody?: string,
  opts?: {
    connectImage?: string;
    doneBody?: string;
    doneImage?: string;
    install?: InstallOptions;
    danger?: DangerGate;
  },
): Step[] {
  return [
    {
      id: `${idPrefix}-flash`,
      type: "action",
      rail: "Install Linux",
      title: "Install Linux",
      body:
        connectBody ??
        "Connect the device over USB and choose it from the list to begin. This takes a few minutes.",
      image: opts?.connectImage,
      gesture: "connect-usb",
      confirmLabel: "Connect & install",
      // Default copy matches the TC8 install, whose rootfs target IS userdata.
      danger: opts?.danger ?? {
        title: "Erase and install?",
        message:
          "This wipes the root partition and installs a fresh operating system — this " +
          "can't be undone. The data partition is left untouched, so files in /root " +
          "(root's home) survive the reinstall.",
        confirmLabel: "Wipe & install",
      },
      run: (ctx) => runFlash(ctx, opts?.install),
    },
    {
      id: `${idPrefix}-done`,
      type: "done",
      rail: "Done",
      title: "Linux installed",
      body: opts?.doneBody ?? "The device is rebooting into Debian.",
      image: opts?.doneImage,
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

/** The grouped Setup block for flows that install AND configure: the OS pick plus
 *  the settings sub-steps, all under one "Setup" rail group. Replaces the old
 *  single combined "setup" page, which stacked the catalog and all nine config
 *  fields past the bottom of the window. `sections` picks the settings pages the
 *  device actually has (default: all). */
export function setupSteps(sections?: SettingsSection[]): Step[] {
  return [{ ...chooseOsStep(), group: "Setup" }, ...settingsSteps("Setup", "first-boot", sections)];
}

export function reinstallLinuxFlow(
  connectBody?: string,
  opts?: {
    connectImage?: string;
    doneBody?: string;
    doneImage?: string;
    install?: InstallOptions;
    danger?: DangerGate;
  },
): Flow {
  return {
    id: "reinstall-linux",
    title: "Install or Update OS",
    summary: "Flash a fresh Debian image onto an already-unlocked device.",
    steps: [
      chooseOsStep(),
      ...osInstallSteps(
        "os",
        connectBody ??
          "When you see the submarine logo, touch the screen with four fingers to enter fastboot. " +
            "Then connect the device over USB and choose it from the list to begin.",
        opts,
      ),
    ],
  };
}
