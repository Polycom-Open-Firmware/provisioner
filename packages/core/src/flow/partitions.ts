// SPDX-License-Identifier: GPL-2.0-or-later

// partitions.ts — verify (and, when allowed, restore) the eMMC GPT over fastboot,
// no serial. A nuked partition table is detected by asking the bootloader for a
// couple of known partitions: it only enumerates partitions that exist in the GPT,
// so if they're absent the table is gone/corrupt. Restore flashes the canonical
// GPT from tc8-gpt-restore.simg (RAW primary @ LBA0, DONT_CARE middle so the env +
// data are preserved, RAW backup at the end) into a runtime-defined whole-disk raw
// target. See tc8-firmware-build/gpt-restore/.
import type { FlowContext } from "../engine/types";

// Representative partitions — if these don't enumerate, the GPT is nuked.
const REQUIRED = ["userdata", "boot_a"];
// Whole user-area eMMC (mmcblk2): 15267840 KiB = 30535680 sectors.
const DISK_SECTORS = 30535680;
const GPT_RESTORE_IMAGE = "tc8-gpt-restore.simg";

async function partitionPresent(ctx: FlowContext, name: string): Promise<boolean> {
  try {
    await ctx.fb.getvar("partition-size:" + name);
    return true;
  } catch {
    // command() throws on a FAIL response → the bootloader has no such partition.
    return false;
  }
}

async function tableOk(ctx: FlowContext): Promise<boolean> {
  for (const p of REQUIRED) if (!(await partitionPresent(ctx, p))) return false;
  return true;
}

/**
 * Ensure the partition table is intact before we touch the filesystem.
 * - Intact → returns.
 * - Nuked + `fix` → restore it from the gpt-restore image (define a whole-disk raw
 *   target, flash the GPT, re-probe, re-verify). No serial.
 * - Nuked + not `fix` → throw. Configure must refuse to write to a borked table.
 */
export async function ensurePartitionTable(
  ctx: FlowContext,
  opts: { fix: boolean },
): Promise<void> {
  ctx.log("checking the partition table…");
  if (await tableOk(ctx)) {
    ctx.log("partition table OK.");
    return;
  }

  ctx.log("partition table is missing or damaged (" + REQUIRED.join(", ") + " not found).");
  if (!opts.fix) {
    throw new Error(
      "This device's partition table is damaged — refusing to write to it. Run " +
        "“Unlock and Install” or “Install or Update OS” first (those repair the table), " +
        "then come back to Configure.",
    );
  }

  ctx.log("restoring the partition table from " + GPT_RESTORE_IMAGE + " (no serial needed)…");
  const simg = await ctx.artifacts.binary(GPT_RESTORE_IMAGE);
  // Named partitions don't exist on a nuked unit, so target a GPT-independent raw
  // region covering the whole user area; the sparse image places the primary GPT at
  // LBA 0 and the backup at the end, leaving everything between untouched.
  await ctx.fb.defineRawPartition("gpt", 0, DISK_SECTORS);
  await ctx.fb.flash("gpt", simg, (d, t) => ctx.progress(d, t),
    (m) => { try { console.info("[fastboot] " + m); } catch { /* no console */ } });

  // Force a re-probe so the running session sees the new table (a fresh probe of a
  // nuked disk caches "no partitions"). Best-effort; harmless if the driver already
  // re-reads on access.
  ctx.log("re-reading the partition table…");
  try {
    await ctx.fb.ucmd("mmc rescan");
  } catch {
    /* not all builds expose this; the re-check below is the real gate */
  }
  if (!(await tableOk(ctx)))
    throw new Error(
      "partition table still not visible after restore — the device may need a reboot " +
        "to re-read it. Power-cycle into fastboot and retry.",
    );
  ctx.log("partition table restored.");
}
