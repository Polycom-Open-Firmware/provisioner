// SPDX-License-Identifier: GPL-2.0-or-later

// c60.ts — the Polycom Trio C60 (codename kepler_proto1) device profile. Like
// tc8.ts, a thin device-specific module that names the flows; the engine is generic.
//
// The C60 differs from the TC8 in how it is first unlocked. The TC8 unlocks over a
// serial + stock-fastboot bootstrap a browser can drive. The C60's BootROM recovery
// is an i.MX SDP / UUU flow: with both BOOT_MODE switches OFF the SoC enumerates as
// `1fc9:0134`, and `uuu -b spl flash.bin` loads our U-Boot (SPL→ATF→U-Boot) into
// DRAM; we then interrupt its autoboot over UART and run the slot's boot sequence
// (see polycom-uboot scripts/c60-dualboot + targets/c60-kepler_proto1/BOOT_RECIPES.md).
// UUU/SDP ships NO WinUSB/WebUSB descriptors, so this flow is `nativeOnly` — the
// native backend runs `uuu` + drives the UART (Backend.c60Provision).
//
// Post-boot the C60 runs the same open U-Boot + Android fastboot gadget as the TC8,
// so Install/Update and Configure are the IDENTICAL flows — reused verbatim.
import type { UsbFilter } from "../transport/transport";
import type { Device, Flow, FlowContext } from "../engine/types";
import { reinstallLinuxFlow } from "../flow/reinstall-linux";
import { configureFlow } from "../flow/configure";

/**
 * Browser USB filters for the C60 in fastboot mode. Once our U-Boot is on the
 * C60 its fastboot gadget matches these; these drive the USB chooser for the
 * Install/Configure flows (post-boot, so browser-reachable like the TC8).
 *
 * TODO(c60-firmware): confirm the C60 fastboot VID/PID. The handoff reports the
 * C60 U-Boot gadget enumerates as `1fc9:0152` (same as our TC8 stage-2).
 */
export const C60_FILTERS: UsbFilter[] = [
  { vendorId: 0x1fc9, productId: 0x0152 }, // our U-Boot fastboot gadget on the C60
];

/**
 * Fetch the C60 boot recipe from the artifact manifest: our U-Boot (`flash.bin`,
 * loaded via SDP) plus the slot boot sequence + CR-hammer window. Kept in the
 * manifest (not hardcoded) because the `mmc read`/`cp.b` addresses in the boot
 * sequence are build-specific — they depend on the packed kernel size and must be
 * regenerated with each image build (see BOOT_RECIPES.md).
 */
async function fetchC60Recipe(
  ctx: FlowContext,
): Promise<{ flashBin: Uint8Array; cmds: string[]; hammerSecs: number }> {
  ctx.log("fetching the C60 boot recipe + open U-Boot (flash.bin)");
  const man = await ctx.artifacts.manifest("c60-manifest.json");
  const fb = man?.flashbin;
  if (!fb || !fb.url) throw new Error("c60 manifest has no flashbin.url");
  const flashBin = await ctx.artifacts.binary(fb.url);
  const cmds: string[] = man?.bootSeq?.a ?? [];
  const hammerSecs: number = typeof man?.hammerSecs === "number" ? man.hammerSecs : 14;
  ctx.log(
    "flash.bin: " + flashBin.byteLength + " bytes; slot-A boot sequence: " + cmds.length + " commands",
  );
  return { flashBin, cmds, hammerSecs };
}

/**
 * The C60 "Unlock and Install" flow — NATIVE ONLY (`nativeOnly`). Runs the proven
 * UUU handoff: SDP → `uuu -b spl flash.bin` (loads our U-Boot into DRAM) → interrupt
 * autoboot over UART → boot slot A (our Debian). Delegates the whole USB+UART dance
 * to `Backend.c60Provision`, which the native backend implements over `uuu` + the
 * `serialport` crate; the web backend leaves it undefined (this flow never runs in a
 * browser — it's greyed "Native app required").
 *
 * NOTE: today this is a DRAM boot of a pre-flashed slot A (images flashed once via
 * the U-Boot fastboot gadget). Persistent autoboot (a `bootcmd` macro so the C60
 * boots without the host) and in-app image flashing are the next phase — see the
 * TODOs in BOOT_RECIPES.md.
 */
export function c60UnlockFlow(): Flow {
  return {
    id: "unlock",
    title: "Unlock and Boot",
    summary: "Load the open bootloader over USB recovery and boot Linux. Native app only.",
    nativeOnly: true,
    steps: [
      {
        id: "intro",
        type: "info",
        rail: "Overview",
        title: "Unlock this device",
        body:
          "Loads the open bootloader over the device's USB recovery mode and boots Linux. " +
          "This uses low-level USB recovery (i.MX SDP / UUU) that a browser can't perform, so " +
          "it runs in the native app only. You'll need both the USB and serial cables connected.",
      },
      {
        id: "sdp-prep",
        type: "confirm",
        rail: "Enter recovery",
        title: "Put the device into recovery mode",
        body:
          "Set both BOOT_MODE switches to OFF so the chip enters serial-download (SDP) mode, " +
          "then connect the USB cable and the serial adapter. Press Continue when it's connected — " +
          "the app will wait for the device to appear.",
        confirmLabel: "Continue",
      },
      {
        id: "uuu-boot",
        type: "action",
        rail: "Load + boot",
        title: "Loading the bootloader and booting Linux",
        body:
          "Loading the open bootloader over USB recovery, then interrupting its autoboot and " +
          "booting the installed Linux slot. Keep both cables connected.",
        run: async (ctx: FlowContext) => {
          if (!ctx.backend.c60Provision)
            throw new Error(
              "C60 unlock needs the native app — USB recovery (UUU/SDP) has no browser support.",
            );
          const { flashBin, cmds, hammerSecs } = await fetchC60Recipe(ctx);
          if (!cmds.length)
            throw new Error("c60 manifest has no slot-A boot sequence (bootSeq.a)");
          await ctx.backend.c60Provision({
            flashBin,
            hammerSecs,
            cmds,
            onLog: ctx.log,
          });
          ctx.log("boot sequence sent — the C60 should be booting Linux.");
        },
      },
      {
        id: "done",
        type: "done",
        rail: "Done",
        title: "Booting Linux",
        body: "The open bootloader is loaded and the device is booting the installed Linux slot.",
      },
    ],
  };
}

export function c60Profile(): Device {
  return {
    id: "c60",
    name: "Polycom Trio C60",
    filters: C60_FILTERS,
    flows: [
      c60UnlockFlow(),
      // Post-boot, identical to the TC8 — reused verbatim.
      reinstallLinuxFlow(),
      configureFlow(),
    ],
  };
}
