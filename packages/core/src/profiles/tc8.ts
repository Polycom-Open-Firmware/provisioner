// tc8.ts — the Polycom TC8 device profile. A profile is the thin, device-specific
// module that names the flows and carries the device's layout facts; the engine
// underneath is generic. Adding another device = another file like this one.
//
// Layout facts ported from the pathfinder `provision-tool/src/manifest.js`
// (DECIDED option-A layout, 2026-06-27): keep the stock Android GPT (no
// repartition); stage-2 lives in the eMMC boot1 HW partition; OS artifacts go
// into existing stock partitions.
import type { UsbFilter } from "../transport/transport";
import type { Device } from "../engine/types";
import { unlockFlow } from "../flow/unlock";
import { reinstallLinuxFlow } from "../flow/reinstall-linux";

/** Browser USB filters that match the TC8 in fastboot mode (stage-2 + stock). */
export const TC8_FILTERS: UsbFilter[] = [
  { vendorId: 0x1fc9, productId: 0x0152 }, // our stage-2 fastboot gadget
  { vendorId: 0x0525, productId: 0xa4a5 }, // stock fastboot (already WinUSB-bound)
];

/** Stage-2 lives in the boot1 HW partition (outside the user-area GPT). */
export const STAGE2_LOCATION = {
  hwpart: "boot1",
  mmcDev: "1 2",
  note: "mmc dev 1 2; mmc write <addr> 0 0x1400",
} as const;

/** Subset of the stock Android GPT we provision into. Identity parts preserved. */
export const STOCK_PARTITIONS = {
  kernel: { name: "boot_a", startLBA: 0x8000, lenSectors: 98304 },
  rootfs: { name: "userdata", startLBA: 13881344, lenSectors: 13365248 },
  transfer: { name: "boot_b", startLBA: 0x20000, lenSectors: 98304 }, // enroll vehicle
} as const;

/** eMMC env block (identity preservation via UCmd printenv/setenv + env save). */
export const ENV = { device: "/dev/mmcblk2", byteOffset: 0x400000, lba: 0x2000 } as const;

export function tc8Profile(): Device {
  return {
    id: "tc8",
    name: "Polycom TC8",
    flows: [
      unlockFlow(),
      reinstallLinuxFlow(),
      {
        id: "reconfigure",
        title: "Reconfigure",
        summary: "Adjust device settings.",
        soon: true,
        steps: [],
      },
    ],
  };
}
