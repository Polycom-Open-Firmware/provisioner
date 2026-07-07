// SPDX-License-Identifier: GPL-2.0-or-later

// unlock.ts — the "Unlock" flow (design notes: 7 steps). One-shot enrollment of
// a fresh TC8: installs our stage-2 bootloader into the eMMC boot1 HW partition
// and sets up chainloading, leaving the unit's partitions otherwise pristine.
// Ported from the pathfinder `provision-tool/src/enroll.js` — same sequence and
// geometry, re-expressed as wizard steps that share a per-flow `state` object.
import { sleep } from "../transport/transport";
import type { Flow, FlowContext } from "../engine/types";
import { osInstallSteps, setupSteps } from "./reinstall-linux";

// --- geometry (option-A layout, identical to tc8_enroll.py / enroll.js) -------
const BOOTB_LBA = 0x20000; // boot_b start (disposable transfer slot, user area)
const STAGE2_LEN = 0x1400; // sectors to move (covers ~1 MB u-boot.bin)
const BACKUP_ADDR = 0x90000000; // RAM: hold boot_b's original sectors
const RELOC_ADDR = 0x40200000; // RAM: scratch for the boot_b->boot1 copy
const STAGE2_SIG = "0a 00 00 14"; // first 4 bytes of a valid stage-2 image

const hex = (n: number) => "0x" + n.toString(16);

// The eMMC's mmc device index is NOT fixed across board revs: the original TC8
// brings the eMMC up as `mmc 1`, but a newer rev enumerates it as `mmc 2` (with
// the empty SD slot at `mmc 1`). Assuming `mmc dev 1` there hits the SD slot
// ("Card did not respond to voltage select") and the enrollment fails. So we
// DETECT the eMMC at runtime (detectEmmc) and thread the index through every mmc
// op AND the persisted chainload. Stage-2 always lives in the eMMC's boot1 HW
// partition (hwpart 2); the stock OS GPT is in the user area (hwpart 0).
const EMMC_HWPART_USER = 0;
const EMMC_HWPART_BOOT1 = 2;
const GPT_PROBE_ADDR = 0x42000000; // RAM scratch for the read-only GPT-signature probe

// chainload from boot1, run under stock stage-1. The literal `\;` is what U-Boot
// needs so the whole script survives setenv as a single value. Built from the
// detected eMMC index so the persisted bootcmd matches the running hardware.
function buildBootcmd(dev: number): string {
  return (
    `mmc dev ${dev} ${EMMC_HWPART_BOOT1}\\; mmc read ${hex(RELOC_ADDR)} 0 ${hex(STAGE2_LEN)}\\; ` +
    `mmc dev ${dev} ${EMMC_HWPART_USER}\\; dcache flush\\; icache off\\; dcache off\\; go ${hex(RELOC_ADDR)}`
  );
}

interface UnlockState {
  originalBootcmd: string;
  emmcDev: number;
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

/**
 * Select an mmc device + HW partition and report whether the switch actually
 * took. Key detail learned on the bench: on a missing SD slot U-Boot prints
 * "Card did not respond…" and leaves the PREVIOUS device current — so a bare
 * `mmc read` afterwards silently hits the wrong device. We therefore gate on the
 * explicit "is current device" success line rather than trusting the read.
 */
async function selectMmc(ctx: FlowContext, dev: number, hwpart: number): Promise<boolean> {
  const out = await ctx.uboot.cmd(`mmc dev ${dev} ${hwpart}`, { expectOk: false });
  return /is current device/i.test(out) &&
    !/not found|did not respond|no mmc device|error/i.test(out);
}

/**
 * Find the eMMC's mmc device index for THIS unit (varies by board rev). Fully
 * read-only: parses `mmc list` (preferring the "(eMMC)" tag), then CONFIRMS each
 * candidate with a successful select + the boot-partition markers in `mmc info`
 * + the stock GPT signature ("EFI PART" at LBA 1). Never writes. Throws with the
 * raw `mmc list` if nothing qualifies, so we abort before touching flash.
 */
async function detectEmmc(ctx: FlowContext): Promise<number> {
  const list = await ctx.uboot.cmd("mmc list", { expectOk: false });
  try { console.info("[unlock] mmc list:\n" + list.trim()); } catch { /* no console */ }

  const tag = list.match(/(\d+)\s*\(eMMC\)/i);
  const tagged = tag ? Number(tag[1]) : null;
  const listed = [...list.matchAll(/:\s*(\d+)\b/g)].map((m) => Number(m[1]));
  // eMMC-tagged index first, then everything the list named, then a fallback scan.
  const order = [...new Set([...(tagged !== null ? [tagged] : []), ...listed, 2, 1, 0])];

  for (const dev of order) {
    if (!(await selectMmc(ctx, dev, EMMC_HWPART_USER))) continue; // couldn't switch → skip
    const info = await ctx.uboot.cmd("mmc info", { expectOk: false });
    if (!/boot\s*area|boot\s*capacity|rpmb/i.test(info)) continue; // no boot HW parts → not eMMC
    // The select succeeded, so this read really targets `dev`: confirm the GPT.
    await ctx.uboot.cmd(`mmc read ${hex(GPT_PROBE_ADDR)} 1 1`, { expectOk: false });
    const dump = await ctx.uboot.cmd(`md.b ${hex(GPT_PROBE_ADDR)} 8`, { expectOk: false });
    const gpt = dump.includes("EFI PART") || /45 46 49 20 50 41 52 54/.test(dump);
    try {
      console.info(
        `[unlock] eMMC candidate mmc dev ${dev}${tagged === dev ? " (list-tagged eMMC)" : ""}: ` +
          `boot partitions present, stock GPT ${gpt ? "found" : "NOT found"}.`,
      );
    } catch { /* no console */ }
    if (gpt) {
      await ctx.uboot.cmd(`mmc dev ${dev} ${EMMC_HWPART_USER}`, { expectOk: false }); // leave user area selected
      return dev;
    }
  }
  throw new Error(
    "could not locate the eMMC (no slot had boot partitions + a stock GPT). mmc list was:\n" +
      list.trim() + "\nAborting before any write — send this so we can add the board rev's layout.",
  );
}

/** Build the Unlock flow. The factory closes over per-run scratch state. */
export function unlockFlow(): Flow {
  const state: UnlockState = { originalBootcmd: "", emmcDev: 0 };

  return {
    id: "unlock",
    title: "Unlock and Install",
    summary: "Unlock a fresh device and install Linux — one-time, needs serial.",
    steps: [
      // The TC8 is PoE/ethernet-only — no Wi-Fi radio, so no Network page (for now).
      ...setupSteps(["device", "access"]),
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
        id: "prep",
        type: "action",
        rail: "Connect serial",
        title: "Connect serial & prepare the device",
        body:
          "Wire up the serial adapter as shown, with the device powered off. Press the button and " +
          "choose the serial port, then power-cycle the device so we can interrupt its boot countdown.",
        gesture: "connect-serial",
        confirmLabel: "Connect & prepare",
        run: async (ctx) => {
          await ctx.connectSerial(115200);
          if (!(await ctx.uboot.catchPrompt(ctx.log)))
            throw new Error("could not reach U-Boot prompt (power-cycle + retry)");

          // recovery snapshot: capture the original bootcmd
          const orig = await ctx.uboot.cmd("printenv bootcmd", { expectOk: false });
          state.originalBootcmd = orig.trim();
          ctx.log("ORIGINAL bootcmd (saved for recovery):\n" + state.originalBootcmd);

          // Which mmc device is the eMMC varies by board rev — detect it now and
          // reuse the index for the backup, the relocate, and the persisted bootcmd.
          state.emmcDev = await detectEmmc(ctx);
          ctx.log("eMMC is mmc dev " + state.emmcDev + " on this unit.");

          // back up boot_b's first sectors to RAM so we can leave boot_b pristine
          ctx.log("backing up boot_b first " + hex(STAGE2_LEN) + " sectors to RAM " + hex(BACKUP_ADDR));
          await ctx.uboot.cmd(`mmc dev ${state.emmcDev} ${EMMC_HWPART_USER}`);
          await ctx.uboot.cmd("mmc read " + hex(BACKUP_ADDR) + " " + hex(BOOTB_LBA) + " " + hex(STAGE2_LEN));

          // enter stock fastboot and let the gadget enumerate
          ctx.log("entering stock fastboot...");
          await ctx.uboot.serial.send("fastboot 0");
          await sleep(2500);
        },
      },
      {
        id: "flash-stage2",
        type: "action",
        rail: "Install bootloader",
        title: "Install the open bootloader",
        body:
          "The device is now in programming mode. Connect it over USB and choose it from the list " +
          "to transfer the open bootloader.",
        gesture: "connect-usb",
        confirmLabel: "Connect & install",
        run: async (ctx) => {
          await ctx.connectUsb();
          const bytes = await fetchStage2(ctx);
          ctx.log("flashing stage-2 -> boot_b (" + bytes.byteLength + " bytes over USB)...");
          await ctx.fb.flash(
            "boot_b",
            bytes,
            (d, t) => ctx.progress(d, t),
            (m) => { try { console.info("[fastboot] " + m); } catch { /* no console */ } },
          );
          ctx.log("flash complete.");
        },
      },
      {
        id: "finalize",
        type: "action",
        rail: "Finalize bootloader",
        title: "Finalizing the bootloader",
        body: "Moving the bootloader into protected storage, then rebooting into programming mode.",
        run: async (ctx) => {
          // exit fastboot back to the prompt (Ctrl-C over serial)
          ctx.log("exiting fastboot (Ctrl-C over serial)");
          await ctx.uboot.sendRaw([0x03]);
          await ctx.uboot.waitFor("=>", 8000);
          try { await ctx.fb.disconnect(); } catch { /* gadget already gone */ }

          const dev = state.emmcDev;

          // copy stage-2 from boot_b -> boot1 (the 2nd boot HW partition)
          ctx.log("copying stage-2 boot_b -> boot1");
          await ctx.uboot.cmd(`mmc dev ${dev} ${EMMC_HWPART_USER}`);
          await ctx.uboot.cmd("mmc read " + hex(RELOC_ADDR) + " " + hex(BOOTB_LBA) + " " + hex(STAGE2_LEN));
          const sig = await ctx.uboot.cmd("md.b " + hex(RELOC_ADDR) + " 4", { expectOk: false });
          if (!sig.includes(STAGE2_SIG))
            throw new Error("stage-2 signature not found after flash:\n" + sig);
          await ctx.uboot.cmd(`mmc dev ${dev} ${EMMC_HWPART_BOOT1}`);
          await ctx.uboot.cmd("mmc write " + hex(RELOC_ADDR) + " 0 " + hex(STAGE2_LEN));
          await ctx.uboot.cmd(`mmc dev ${dev} ${EMMC_HWPART_USER}`);

          // restore boot_b from the RAM backup (leave it pristine)
          ctx.log("restoring boot_b from backup");
          await ctx.uboot.cmd("mmc write " + hex(BACKUP_ADDR) + " " + hex(BOOTB_LBA) + " " + hex(STAGE2_LEN));

          // set up chainloading + persist, then reboot into stage-2. The bootcmd is
          // built from the detected eMMC index so it matches this unit's hardware.
          ctx.log("installing chainload bootcmd + saveenv (eMMC = mmc dev " + dev + ")");
          await ctx.uboot.cmd("setenv bootcmd '" + buildBootcmd(dev) + "'");
          await ctx.uboot.cmd("saveenv");
          ctx.log("bootloader installed + chainload persisted.");

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
