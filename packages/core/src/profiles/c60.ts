// SPDX-License-Identifier: GPL-2.0-or-later

// c60.ts — the Polycom Trio C60 device profile. Like tc8.ts, this is the thin,
// device-specific module that names the flows; the engine underneath is generic.
//
// The C60 differs from the TC8 in exactly ONE place: how it is first unlocked.
// The TC8 unlocks over a serial + stock-fastboot bootstrap that a browser can
// drive. The C60's BootROM recovery is an i.MX SDP / UUU flow (loads SPL over
// USB, then our U-Boot), and UUU ships NO WinUSB/WebUSB descriptors — a browser
// physically cannot speak it. So the C60 Unlock flow is `nativeOnly` (greyed out
// in the web flavor with "Native app required"); the real UUU sequence lands in
// the native flavor once the handoff spec is finalized (see c60UnlockFlow below).
//
// AFTER unlock, the C60 runs the SAME open U-Boot with the SAME Android fastboot
// gadget as the TC8, so Install/Update and Configure are the IDENTICAL flows —
// reused verbatim, no C60-specific code.
import type { UsbFilter } from "../transport/transport";
import type { Device, Flow, FlowContext } from "../engine/types";
import { reinstallLinuxFlow, osInstallSteps, chooseOsStep } from "../flow/reinstall-linux";
import { configureFlow } from "../flow/configure";

/**
 * Browser USB filters for the C60 in fastboot mode. Once our U-Boot is on the
 * C60 its fastboot gadget matches these; these drive the USB chooser for the
 * Install/Configure flows (post-unlock, so browser-reachable like the TC8).
 *
 * TODO(c60-firmware): confirm the C60 stage-2 fastboot VID/PID against the
 * actual C60 U-Boot build. Placeholder = our TC8 stage-2 gadget IDs, which is
 * the likely value if the same gadget config is reused; the stock C60 fastboot
 * (if any) may present different IDs and should be added here.
 */
export const C60_FILTERS: UsbFilter[] = [
  { vendorId: 0x1fc9, productId: 0x0152 }, // our stage-2 fastboot gadget (TBD for C60)
];

/**
 * The C60 "Unlock and Install" flow — NATIVE ONLY.
 *
 * The unlock itself is an i.MX SDP / UUU BootROM-recovery sequence: put the C60
 * into serial-download mode, run a UUU script that loads SPL + our U-Boot over
 * USB, persist the chainload, then drop into fastboot. UUU has no WebUSB path,
 * so this flow is gated to the native flavor (`nativeOnly`) and its unlock action
 * is a stub until the UUU handoff spec lands.
 *
 * Structurally it mirrors the TC8 unlock (choose OS + settings up front, then the
 * shared `osInstallSteps` tail once the device is trapped in fastboot) so the
 * real UUU sequence drops straight into the `uuu-unlock` step below.
 */
export function c60UnlockFlow(): Flow {
  return {
    id: "unlock",
    title: "Unlock and Install",
    summary: "First-time unlock over USB recovery, then install Linux. Native app only.",
    nativeOnly: true,
    steps: [
      {
        id: "intro",
        type: "info",
        rail: "Overview",
        title: "Unlock this device",
        body:
          "A one-time setup that installs the open bootloader over the device's USB recovery " +
          "mode, then installs Linux. This step uses low-level USB recovery that a browser " +
          "can't perform, so it runs in the native app only.",
      },
      chooseOsStep(),
      {
        id: "settings",
        type: "confirm",
        rail: "Settings",
        title: "Choose what to apply",
        body:
          "Set the values you want this device to start with. Anything you leave blank is left " +
          "at its default. These are written during install and applied on first boot. When " +
          "you're ready, press Continue.",
        confirmLabel: "Continue",
      },
      {
        id: "uuu-unlock",
        type: "action",
        rail: "Unlock bootloader",
        title: "Installing the open bootloader",
        body:
          "Putting the device into USB recovery and loading the open bootloader. Follow the " +
          "on-screen prompts to enter recovery mode.",
        // TODO(c60-uuu-handoff): implement the UUU / i.MX SDP recovery sequence
        // here. Requires the native SDP transport (Tauri -> Rust nusb/hidapi) and
        // the UUU script from the background-agent handoff. On success this leaves
        // the C60 trapped in our stage-2 fastboot gadget, ready for osInstallSteps.
        run: async (_ctx: FlowContext) => {
          throw new Error(
            "C60 unlock (UUU/SDP recovery) is not implemented yet — awaiting the UUU handoff " +
              "and the native SDP transport. This flow runs in the native app only.",
          );
        },
      },
      ...osInstallSteps(
        "os",
        "The open bootloader is installed and the device is in programming mode. Connect it " +
          "over USB, then press Continue and choose it from the list.",
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
      // Post-unlock, identical to the TC8 — reused verbatim.
      reinstallLinuxFlow(),
      configureFlow(),
    ],
  };
}
