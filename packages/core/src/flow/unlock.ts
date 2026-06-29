// SPDX-License-Identifier: GPL-2.0-or-later

// unlock.ts — the "Unlock" flow (design notes: 7 steps). One-shot enrollment of
// a fresh TC8: installs our stage-2 bootloader into the eMMC boot1 HW partition
// and sets up chainloading, leaving the unit's partitions otherwise pristine.
// Ported from the pathfinder `provision-tool/src/enroll.js` — same sequence and
// geometry, re-expressed as wizard steps that share a per-flow `state` object.
import { sleep } from "../transport/transport";
import type { Flow, FlowContext } from "../engine/types";
import { osInstallSteps, chooseOsStep } from "./reinstall-linux";

// --- geometry (option-A layout, identical to tc8_enroll.py / enroll.js) -------
const BOOTB_LBA = 0x20000; // boot_b start (disposable transfer slot, user area)
const STAGE2_LEN = 0x1400; // sectors to move (covers ~1 MB u-boot.bin)
const BACKUP_ADDR = 0x90000000; // RAM: hold boot_b's original sectors
const RELOC_ADDR = 0x40200000; // RAM: scratch for the boot_b->boot1 copy
const STAGE2_SIG = "0a 00 00 14"; // first 4 bytes of a valid stage-2 image

// chainload from boot1 (HW part 2), run under stock stage-1. The literal `\;` is
// what U-Boot needs so the whole script survives setenv as a single value.
const BOOTCMD =
  "mmc dev 1 2\\; mmc read 0x40200000 0 0x1400\\; mmc dev 1 0\\; " +
  "dcache flush\\; icache off\\; dcache off\\; go 0x40200000";

const hex = (n: number) => "0x" + n.toString(16);

interface UnlockState {
  originalBootcmd: string;
}

async function fetchStage2(ctx: FlowContext): Promise<Uint8Array> {
  ctx.log("fetching stage-2 manifest");
  const manifest = await ctx.artifacts.manifest("manifest.json");
  const s2 = manifest?.stage2;
  if (!s2 || !s2.url) throw new Error("manifest has no stage2.url");
  const bytes = await ctx.artifacts.binary(s2.url);
  ctx.log(
    "stage-2 binary: " + bytes.byteLength + " bytes" +
      (s2.md5 ? " (manifest md5 " + s2.md5 + ")" : ""),
  );
  return bytes;
}

/** Build the Unlock flow. The factory closes over per-run scratch state. */
export function unlockFlow(): Flow {
  const state: UnlockState = { originalBootcmd: "" };

  return {
    id: "unlock",
    title: "Unlock and Install",
    summary: "Unlock a fresh device and install Linux — one-time, needs serial.",
    steps: [
      {
        id: "intro",
        type: "info",
        rail: "Overview",
        title: "Unlock this device",
        body:
          "A one-time setup that installs the open bootloader and then Linux, so the " +
          "device is ready to use. You'll need the serial adapter and a USB cable.",
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
        id: "disassembly",
        type: "info",
        rail: "Open the case",
        title: "Open the device",
        body: "Open the housing to reach the serial header inside.",
        gallery: [
          "/disassembly/01.jpg",
          "/disassembly/02.jpg",
          "/disassembly/03.jpg",
          "/disassembly/04.jpg",
          "/disassembly/05.jpg",
          "/disassembly/06.jpg",
          "/disassembly/07.jpg",
          "/disassembly/08.jpg",
        ],
      },
      {
        id: "connect-serial",
        type: "confirm",
        rail: "Connect serial",
        title: "Connect the serial adapter",
        body:
          "Wire up the serial adapter as shown, with the device powered off, then press " +
          "Continue and choose the port.",
        confirmLabel: "Continue",
        gesture: "connect-serial",
      },
      {
        id: "prep",
        type: "action",
        rail: "Prepare device",
        title: "Catching the bootloader",
        body: "Power-cycle the device now so we can interrupt its boot countdown.",
        run: async (ctx) => {
          await ctx.connectSerial(115200);
          if (!(await ctx.uboot.catchPrompt(ctx.log)))
            throw new Error("could not reach U-Boot prompt (power-cycle + retry)");

          // recovery snapshot: capture the original bootcmd
          const orig = await ctx.uboot.cmd("printenv bootcmd", { expectOk: false });
          state.originalBootcmd = orig.trim();
          ctx.log("ORIGINAL bootcmd (saved for recovery):\n" + state.originalBootcmd);

          // back up boot_b's first sectors to RAM so we can leave boot_b pristine
          ctx.log("backing up boot_b first " + hex(STAGE2_LEN) + " sectors to RAM " + hex(BACKUP_ADDR));
          await ctx.uboot.cmd("mmc dev 1 0");
          await ctx.uboot.cmd("mmc read " + hex(BACKUP_ADDR) + " " + hex(BOOTB_LBA) + " " + hex(STAGE2_LEN));

          // enter stock fastboot and let the gadget enumerate
          ctx.log("entering stock fastboot...");
          await ctx.uboot.serial.send("fastboot 0");
          await sleep(2500);
        },
      },
      {
        id: "connect-usb",
        type: "confirm",
        rail: "Connect USB",
        title: "Connect over USB",
        body:
          "The device is now in programming mode, ready to receive the new unlocked " +
          "bootloader. Connect it to this computer over USB, then press Continue and " +
          "choose it from the list.",
        confirmLabel: "Continue",
        gesture: "connect-usb",
      },
      {
        id: "flash-stage2",
        type: "action",
        rail: "Flash bootloader",
        title: "Installing the bootloader",
        body: "Transferring the second-stage bootloader to the device.",
        run: async (ctx) => {
          await ctx.connectUsb();
          const bytes = await fetchStage2(ctx);
          ctx.log("flashing stage-2 -> boot_b (" + bytes.byteLength + " bytes over USB)...");
          await ctx.fb.flash(
            "boot_b",
            bytes,
            (d, t) => ctx.progress(d, t),
            (m) => ctx.log("  INFO " + m),
          );
          ctx.log("flash complete.");
        },
      },
      {
        id: "relocate",
        type: "action",
        rail: "Finalize bootloader",
        title: "Finalizing",
        body: "Moving the bootloader into protected storage and enabling chainload.",
        run: async (ctx) => {
          // exit fastboot back to the prompt (Ctrl-C over serial)
          ctx.log("exiting fastboot (Ctrl-C over serial)");
          await ctx.uboot.sendRaw([0x03]);
          await ctx.uboot.waitFor("=>", 8000);
          try { await ctx.fb.disconnect(); } catch { /* gadget already gone */ }

          // copy stage-2 from boot_b -> boot1 (the 2nd boot HW partition)
          ctx.log("copying stage-2 boot_b -> boot1");
          await ctx.uboot.cmd("mmc dev 1 0");
          await ctx.uboot.cmd("mmc read " + hex(RELOC_ADDR) + " " + hex(BOOTB_LBA) + " " + hex(STAGE2_LEN));
          const sig = await ctx.uboot.cmd("md.b " + hex(RELOC_ADDR) + " 4", { expectOk: false });
          if (!sig.includes(STAGE2_SIG))
            throw new Error("stage-2 signature not found after flash:\n" + sig);
          await ctx.uboot.cmd("mmc dev 1 2");
          await ctx.uboot.cmd("mmc write " + hex(RELOC_ADDR) + " 0 " + hex(STAGE2_LEN));
          await ctx.uboot.cmd("mmc dev 1 0");

          // restore boot_b from the RAM backup (leave it pristine)
          ctx.log("restoring boot_b from backup");
          await ctx.uboot.cmd("mmc write " + hex(BACKUP_ADDR) + " " + hex(BOOTB_LBA) + " " + hex(STAGE2_LEN));

          // set up chainloading + persist, then reboot into stage-2
          ctx.log("installing chainload bootcmd + saveenv");
          await ctx.uboot.cmd("setenv bootcmd '" + BOOTCMD + "'");
          await ctx.uboot.cmd("saveenv");
          ctx.log("bootloader installed + chainload persisted.");
        },
      },
      {
        id: "trap",
        type: "action",
        rail: "Reboot to fastboot",
        title: "Catching it before it reboots",
        body:
          "Putting the device into programming mode again with the new bootloader, to " +
          "prepare it for the OS install.",
        run: async (ctx) => {
          // Reboot. Stock stage-1 chainloads stage-2 — we must LET that happen, then
          // interrupt stage-2's 3 s autoboot before it runs `boota`: on a stock unit
          // boota would boot the leftover Android straight into a scary recovery
          // loop (bad OOBE). So wait for the SECOND (stage-2) banner, then catch its
          // prompt and drop it into fastboot.
          ctx.log("rebooting into the second-stage bootloader...");
          await ctx.uboot.serial.send("reset");
          const banner = await ctx.uboot.waitFor("U-Boot 2024.04", 25000);
          if (!banner.includes("U-Boot 2024.04"))
            throw new Error("did not see the second-stage bootloader within 25 s — check serial and retry.");
          ctx.log("second-stage up — trapping it before it boots an OS...");
          const caught = await ctx.uboot.catchPrompt(
            ctx.log,
            400,
            "interrupting the second-stage autoboot (3 s window)...",
          );
          if (!caught)
            throw new Error("could not catch the second-stage prompt in time (it may have booted) — power-cycle and retry.");
          ctx.log("entering fastboot (fastboot usb 0)...");
          await ctx.uboot.serial.send("fastboot usb 0"); // 2024.04 syntax; blocks serving the gadget
          await sleep(2500); // let the stage-2 gadget enumerate
          ctx.log("trapped in fastboot — connect over USB to install the OS.");
        },
      },
      ...osInstallSteps(
        "os",
        "The new bootloader is ready to receive an operating system. Connect it over " +
          "USB, then press Continue and choose it from the list.",
      ),
    ],
  };
}
