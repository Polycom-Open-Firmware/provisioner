// SPDX-License-Identifier: GPL-2.0-or-later
//
// Resparse regression tests. The device-side acceptance check we must satisfy is
// U-Boot's lib/image-sparse.c write_sparse_image(): it sums chunk_sz across EVERY
// chunk of a sub-image (RAW + FILL + DONT_CARE) and rejects the write with
// "sparse image write failure" unless that running total equals the sub-image
// header's total_blks. A single-sub-image flash always balanced; a 2+ way split
// (payload > device max-download-size, e.g. the 1 GiB chromium rootfs) exposed a
// bug where every non-final sub-image over-declared total_blks. These tests
// reproduce the device check in pure JS so we catch a regression without hardware.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  parseSparse,
  planResparse,
  __buildSubimageForTest as buildSubimage,
  SPARSE_MAGIC,
} from "./sparse";

const FILE_HDR_SZ = 28;
const CHUNK_HDR_SZ = 12;
const CHUNK_RAW = 0xcac1;
const CHUNK_FILL = 0xcac2;
const CHUNK_DONT_CARE = 0xcac3;

/** Reproduce U-Boot write_sparse_image()'s block accounting for one sub-image.
 *  Returns {declared, summed} — the device fails the write unless they're equal. */
function ubootCheck(img: Uint8Array): { declared: number; summed: number; chunks: number } {
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  expect(dv.getUint32(0, true)).toBe(SPARSE_MAGIC);
  const declared = dv.getUint32(16, true);
  const totalChunks = dv.getUint32(20, true);
  let off = FILE_HDR_SZ;
  let summed = 0;
  for (let c = 0; c < totalChunks; c++) {
    const type = dv.getUint16(off, true);
    const chunkSz = dv.getUint32(off + 4, true); // blocks
    const totalSz = dv.getUint32(off + 8, true); // bytes incl header
    summed += chunkSz; // every chunk type contributes its chunk_sz to total_blocks
    if (type === CHUNK_DONT_CARE) expect(totalSz).toBe(CHUNK_HDR_SZ); // no payload
    off += totalSz;
  }
  expect(off).toBe(img.byteLength); // chunks exactly fill the sub-image
  return { declared, summed, chunks: totalChunks };
}

/** Build a minimal well-formed source sparse image from a chunk spec. */
function makeSparse(blkSz: number, spec: Array<{ type: number; blocks: number; byte?: number }>): Uint8Array {
  let total = FILE_HDR_SZ;
  let totalBlks = 0;
  for (const s of spec) {
    total += CHUNK_HDR_SZ + (s.type === CHUNK_RAW ? s.blocks * blkSz : 0);
    totalBlks += s.blocks;
  }
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, SPARSE_MAGIC, true);
  dv.setUint16(4, 1, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, FILE_HDR_SZ, true);
  dv.setUint16(10, CHUNK_HDR_SZ, true);
  dv.setUint32(12, blkSz, true);
  dv.setUint32(16, totalBlks, true);
  dv.setUint32(20, spec.length, true);
  dv.setUint32(24, 0, true);
  let off = FILE_HDR_SZ;
  for (const s of spec) {
    const dataLen = s.type === CHUNK_RAW ? s.blocks * blkSz : 0;
    dv.setUint16(off, s.type, true);
    dv.setUint32(off + 4, s.blocks, true);
    dv.setUint32(off + 8, CHUNK_HDR_SZ + dataLen, true);
    off += CHUNK_HDR_SZ;
    if (dataLen) {
      out.fill(s.byte ?? 0xab, off, off + dataLen);
      off += dataLen;
    }
  }
  return out;
}

function buildAll(simg: Uint8Array, maxDownload: number) {
  const parsed = parseSparse(simg);
  const plan = planResparse(parsed, maxDownload);
  return plan.subimages.map((s) => buildSubimage(parsed, s, plan.totalBlks, plan.blkSz));
}

describe("resparse sub-image total_blks (U-Boot acceptance)", () => {
  it("every sub-image passes the device block-sum check on a forced multi-way split", () => {
    const blkSz = 4096;
    // 300 data blocks split by a hole, forced to split into many sub-images by a
    // tiny max-download so most sub-images end well before the last block.
    const simg = makeSparse(blkSz, [
      { type: CHUNK_RAW, blocks: 200, byte: 0x11 },
      { type: CHUNK_DONT_CARE, blocks: 50 },
      { type: CHUNK_RAW, blocks: 100, byte: 0x22 },
    ]);
    const maxDownload = FILE_HDR_SZ + 2 * CHUNK_HDR_SZ + 20 * blkSz; // ~20 data blocks/sub-image
    const subs = buildAll(simg, maxDownload);
    expect(subs.length).toBeGreaterThan(2); // genuinely multi-way
    for (const img of subs) {
      expect(img.byteLength).toBeLessThanOrEqual(maxDownload);
      const { declared, summed } = ubootCheck(img);
      expect(summed).toBe(declared); // the bug: non-final sub-images had declared > summed
    }
  });

  it("single sub-image still declares the full block count", () => {
    const blkSz = 4096;
    const simg = makeSparse(blkSz, [
      { type: CHUNK_RAW, blocks: 4, byte: 0x33 },
      { type: CHUNK_DONT_CARE, blocks: 8 },
      { type: CHUNK_RAW, blocks: 4, byte: 0x44 },
    ]);
    const subs = buildAll(simg, 1 << 20); // plenty — one sub-image
    expect(subs).toHaveLength(1);
    const { declared, summed } = ubootCheck(subs[0]!);
    expect(summed).toBe(declared);
    expect(declared).toBe(16); // 4 + 8 + 4, the whole image
  });

  const realImg = "/home/alex/polycom_dev/tc8/tc8-artifacts/rootfs.simg";
  it.runIf(existsSync(realImg))(
    "the real chromium rootfs.simg passes on every sub-image at the device's 1 GiB buffer",
    () => {
      const simg = new Uint8Array(readFileSync(realImg));
      const maxDownload = 0x40000000; // CONFIG_FASTBOOT_BUF_SIZE on the TC8/C60
      const subs = buildAll(simg, maxDownload);
      expect(subs.length).toBeGreaterThan(1); // this image is why the bug surfaced
      for (const img of subs) {
        expect(img.byteLength).toBeLessThanOrEqual(maxDownload);
        const { declared, summed } = ubootCheck(img);
        expect(summed).toBe(declared);
      }
    },
  );
});
