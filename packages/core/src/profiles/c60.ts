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
import type { DangerGate, Device, Flow, FlowContext } from "../engine/types";
import { SDP_PID_BOOTROM, SDP_PID_SPL, SDP_VID } from "../protocol/sdp";
import { reinstallLinuxFlow, osInstallSteps, setupSteps } from "../flow/reinstall-linux";
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
export function c60UnlockFlow(): Flow {
  const flash: { bin: Uint8Array | null } = { bin: null };
  return {
    id: "unlock",
    title: "Unlock and Install",
    summary: "Load the open bootloader over USB recovery and install Linux — all in the browser.",
    steps: [
      ...setupSteps(),
      {
        id: "load-spl",
        type: "action",
        rail: "Enter recovery",
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
          doneBody:
            "The device is rebooting into Debian. If the BOOT_MODE switches are still in the " +
            "recovery position, flip them back and power-cycle — in recovery position the device " +
            "comes back as a USB recovery device instead of booting.",
          doneImage: "/c60/switches-back.svg",
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
      // Post-boot, the same flows as the TC8. Install reads its rootfs target and
      // raw partition map from the manifest. Configure also uses the raw cache LBA
      // because C60 fastboot does not reliably answer GPT partition-size probes.
      reinstallLinuxFlow(
        "The C60 enters fastboot through USB recovery: set both BOOT_MODE switches to OFF, " +
          "power-cycle, and run the two recovery steps of Unlock and Install — or, if the device " +
          "is already in fastboot, connect it over USB and choose it from the list.",
        {
          connectImage: "/c60/usb-connect.svg",
          install: { replaceBootloader: true },
          danger: C60_INSTALL_DANGER,
          doneBody:
            "The device is rebooting into Debian. If the BOOT_MODE switches are still in the " +
            "recovery position, flip them back and power-cycle — in recovery position the device " +
            "comes back as a USB recovery device instead of booting.",
          doneImage: "/c60/switches-back.svg",
        },
      ),
      configureFlow({ rawConfig: { startLBA: 0x738000, sizeLBA: 0x200000 } }),
    ],
  };
}
