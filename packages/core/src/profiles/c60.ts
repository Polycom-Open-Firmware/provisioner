// SPDX-License-Identifier: GPL-2.0-or-later

// c60.ts — the Polycom Trio C60 (codename kepler_proto1, i.MX8MM) device profile.
//
// The C60's first-time unlock is an i.MX Serial Download Protocol (SDP) load: with
// both BOOT_MODE switches OFF the SoC enumerates as a HID device (1fc9:0134), and
// we load our U-Boot into RAM in two stages (SPL → the SPL's SDPV gadget loads the
// U-Boot FIT). This was the "needs a native app" case — until we proved the BootROM
// HID interface (usage page 0xFF00) is reachable over **WebHID**. So the whole C60
// unlock now runs in the browser (WebHID SDP → U-Boot → WebUSB fastboot → install),
// no uuu / no driver / no native app. (`packages/native/src-tauri/src/sdp.rs` remains
// a pure-Rust fallback for the Tauri webview, which has no WebHID.)
//
// After boot the C60 runs the same open U-Boot + Android fastboot gadget as the TC8,
// so Install/Update and Configure are the IDENTICAL flows — reused verbatim.
import type { UsbFilter } from "../transport/transport";
import type { DangerGate, Device, Flow, FlowContext, Step } from "../engine/types";
import { SDP_PID_BOOTROM, SDP_PID_SPL, SDP_VID } from "../protocol/sdp";
import { osInstallSteps, setupSteps } from "../flow/reinstall-linux";
import { configureFlow } from "../flow/configure";

/** The C60 U-Boot fastboot gadget (post-boot), for the Install/Configure choosers. */
export const C60_FILTERS: UsbFilter[] = [
  { vendorId: 0x1fc9, productId: 0x0152 },
];

/** The C60 install overwrites slot A (system_a), not userdata — the default TC8
 *  "WIPE userdata" warning would be wrong here. */
const C60_INSTALL_DANGER: DangerGate = {
  title: "Replace the installed OS?",
  message:
    "This will REPLACE the operating system installed on this device (system slot A). " +
    "User data on other partitions is not touched.",
  confirmLabel: "Replace OS",
};

/** Fastboot re-entry on an unlocked C60: the persisted open U-Boot traps into
 *  fastboot on the four-finger gesture during its boot window. `goal` finishes
 *  the "choose it from the list to …" sentence per flow. */
const c60Reentry = (goal: string) =>
  "Power-cycle the device with the USB cable connected. When the mic/center light cue " +
  "appears, hold four fingers on the screen during the 20-second window — the device " +
  "enters programming mode. Then choose it from the list to " + goal + ".";

/** Fetch our U-Boot (`flash.bin`) once per run — loaded into RAM over SDP. */
async function getFlash(ctx: FlowContext, cache: { bin: Uint8Array | null }): Promise<Uint8Array> {
  if (cache.bin) return cache.bin;
  const man = await ctx.artifacts.manifest("c60-manifest.json");
  const fb = man?.flashbin;
  if (!fb || !fb.url) throw new Error("c60 manifest has no flashbin.url");
  cache.bin = await ctx.artifacts.binary(fb.url);
  ctx.log("open U-Boot (flash.bin): " + cache.bin.byteLength + " bytes");
  return cache.bin;
}

/**
 * The C60 "Unlock and Install" flow — browser-native (WebHID SDP). Loads our
 * U-Boot over the BootROM (SPL) then the SPL's download gadget (U-Boot FIT); the
 * device boots and drops into fastboot, then the shared OS-install steps flash Linux
 * over WebUSB — the same tail as the TC8 unlock.
 */
/** The two SDP recovery steps (BootROM → SPL gadget), grouped in the rail as one
 *  "Recovery" tier. `flash` is the per-flow cache so flash.bin downloads once. */
function c60RecoverySteps(flash: { bin: Uint8Array | null }): Step[] {
  return [
    {
      id: "load-spl",
      type: "action",
      rail: "Enter recovery",
      group: "Recovery",
      title: "Connect in recovery mode",
      body:
        "Set both BOOT_MODE switches to OFF so the chip enters USB recovery, and connect the USB " +
        "cable. Press the button and choose the recovery device (a vendor HID device) to load the " +
        "first stage.",
      image: "/c60/recovery-mode.svg",
      gesture: "connect-hid",
      confirmLabel: "Connect & load",
      hidFilters: [{ vendorId: SDP_VID, productId: SDP_PID_BOOTROM }],
      run: async (ctx) => {
        await ctx.connectHid();
        const bin = await getFlash(ctx, flash);
        await ctx.sdp.bootSpl(bin, ctx.log);
      },
    },
    {
      id: "load-uboot",
      type: "action",
      rail: "Start bootloader",
      group: "Recovery",
      title: "Reconnect & start the bootloader",
      body:
        "The first stage brought up memory and the device re-appeared as a download gadget. Press " +
        "the button and choose it again to load and start the open bootloader.",
      image: "/c60/usb-connect.svg",
      gesture: "connect-hid",
      confirmLabel: "Connect & start",
      hidFilters: [{ vendorId: SDP_VID, productId: SDP_PID_SPL }],
      run: async (ctx) => {
        await ctx.connectHid();
        const bin = await getFlash(ctx, flash);
        await ctx.sdp.bootUboot(bin, ctx.log);
      },
    },
  ];
}

export function c60UnlockFlow(): Flow {
  const flash: { bin: Uint8Array | null } = { bin: null };
  return {
    id: "unlock",
    title: "Unlock and Install",
    summary: "Load the open bootloader over USB recovery and install Linux — all in the browser.",
    steps: [
      ...setupSteps(),
      ...c60RecoverySteps(flash),
      ...osInstallSteps(
        "os",
        "The open bootloader is starting and the device will enter programming mode. When it does, " +
          "connect it over USB and choose it from the list to install Linux. While it flashes, flip " +
          "both BOOT_MODE switches back to their normal position — they are only read at power-on, " +
          "so the device reboots straight into Linux when the install finishes.",
        {
          connectImage: "/c60/usb-connect.svg",
          install: { replaceBootloader: true },
          danger: C60_INSTALL_DANGER,
        },
      ),
    ],
  };
}

/** C60 Install/Update: a full reprovision pass on an already-unlocked device.
 *  Setup (OS + settings) then the install tail — runFlash writes the config blob
 *  in the same fastboot session when any settings were filled, so one pass
 *  reflashes AND reconfigures; all-blank settings mean a plain reflash. */
function c60InstallFlow(): Flow {
  return {
    id: "reinstall-linux",
    title: "Install or Update OS",
    summary: "Reflash Debian on an unlocked device — settings optional, applied on first boot.",
    steps: [
      ...setupSteps(),
      ...osInstallSteps(
        "os",
        c60Reentry("begin") +
          " If it never appears — for example the device still has its stock bootloader — set " +
          "both BOOT_MODE switches to OFF and use Unlock and Install instead.",
        {
          connectImage: "/c60/usb-connect.svg",
          install: { replaceBootloader: true },
          danger: C60_INSTALL_DANGER,
        },
      ),
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
      // Post-boot, the same fastboot machinery as the TC8, with C60 structure and
      // copy. Install reads its rootfs target and raw partition map from the
      // manifest. Configure uses the raw cache LBA because C60 fastboot does not
      // reliably answer GPT partition-size probes.
      c60InstallFlow(),
      configureFlow({
        rawConfig: { startLBA: 0x738000, sizeLBA: 0x200000 },
        connectBody: c60Reentry("apply the settings"),
        connectImage: "/c60/usb-connect.svg",
      }),
    ],
  };
}
