// SPDX-License-Identifier: GPL-2.0-or-later

// sparse.ts — Android sparse image RESPARSE + flash over fastboot. Ported from
// the pathfinder `provision-tool/src/sparse.js` (pure DataView/Uint8Array logic,
// no platform calls — it only drives a Fastboot instance).
//
// Our build emits a complete Android sparse image of the (multi-GiB, mostly-zero)
// ext4 rootfs. Even the sparse payload can exceed the device max-download-size,
// so this module re-splits ("resparses") it into N self-contained sub-images,
// each <= fb.maxDownload, and flashes them in sequence. When a sub-image doesn't
// start at block 0 it carries a leading DONT_CARE chunk so the device's sparse
// writer lands the data at the right partition offset, and its header total_blks
// counts only the blocks that sub-image covers (offset + its own chunks) — the
// device rejects any sub-image whose chunk-block sum != its header total_blks.
import type { Fastboot, InfoCb, ProgressCb } from "./fastboot";

const SPARSE_MAGIC = 0xed26ff3a;
const MAJOR_VERSION = 1;
const MINOR_VERSION = 0;
const FILE_HDR_SZ = 28;
const CHUNK_HDR_SZ = 12;

const CHUNK_TYPE_RAW = 0xcac1;
const CHUNK_TYPE_FILL = 0xcac2;
const CHUNK_TYPE_DONT_CARE = 0xcac3;
const CHUNK_TYPE_CRC32 = 0xcac4;

interface Chunk {
  type: number;
  blocks: number;
  dataOff: number;
  dataLen: number;
}
interface ParsedSparse {
  blkSz: number;
  totalBlks: number;
  totalChunks: number;
  chunks: Chunk[];
  u8: Uint8Array;
}
interface SubImage {
  startBlock: number;
  items: Chunk[];
  size: number;
}
interface ResparsePlan {
  totalBlks: number;
  blkSz: number;
  subimages: SubImage[];
}

/** Parse a complete Android sparse image; validates header + every chunk. */
export function parseSparse(simgBuffer: Uint8Array | ArrayBuffer): ParsedSparse {
  const u8 = simgBuffer instanceof Uint8Array ? simgBuffer : new Uint8Array(simgBuffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < FILE_HDR_SZ) throw new Error("sparse: buffer shorter than header");

  const magic = dv.getUint32(0, true);
  if (magic !== SPARSE_MAGIC)
    throw new Error("sparse: bad magic 0x" + magic.toString(16) + " (want 0xed26ff3a)");
  const major = dv.getUint16(4, true);
  const fileHdrSz = dv.getUint16(8, true);
  const chunkHdrSz = dv.getUint16(10, true);
  const blkSz = dv.getUint32(12, true);
  const totalBlks = dv.getUint32(16, true);
  const totalChunks = dv.getUint32(20, true);
  if (major !== MAJOR_VERSION) throw new Error("sparse: unsupported major_version " + major);
  if (fileHdrSz < FILE_HDR_SZ) throw new Error("sparse: short file_hdr_sz " + fileHdrSz);
  if (chunkHdrSz < CHUNK_HDR_SZ) throw new Error("sparse: short chunk_hdr_sz " + chunkHdrSz);
  if (blkSz === 0 || blkSz % 4 !== 0) throw new Error("sparse: bad blk_sz " + blkSz);

  const chunks: Chunk[] = [];
  let off = fileHdrSz;
  for (let c = 0; c < totalChunks; c++) {
    if (off + chunkHdrSz > u8.byteLength) throw new Error("sparse: truncated at chunk " + c);
    const type = dv.getUint16(off, true);
    const blocks = dv.getUint32(off + 4, true);
    const totalSz = dv.getUint32(off + 8, true);
    const dataOff = off + chunkHdrSz;
    const dataLen = totalSz - chunkHdrSz;
    switch (type) {
      case CHUNK_TYPE_RAW:
        if (dataLen !== blocks * blkSz)
          throw new Error("sparse: RAW chunk " + c + " data " + dataLen + " != " + blocks * blkSz);
        break;
      case CHUNK_TYPE_DONT_CARE:
        if (dataLen !== 0) throw new Error("sparse: DONT_CARE chunk " + c + " has payload");
        break;
      case CHUNK_TYPE_FILL:
      case CHUNK_TYPE_CRC32:
        if (dataLen !== 4) throw new Error("sparse: FILL/CRC32 chunk " + c + " data " + dataLen);
        break;
      default:
        throw new Error("sparse: unknown chunk type 0x" + type.toString(16) + " at " + c);
    }
    if (dataOff + dataLen > u8.byteLength)
      throw new Error("sparse: chunk " + c + " payload overruns buffer");
    chunks.push({ type, blocks, dataOff, dataLen });
    off += chunkHdrSz + dataLen;
  }
  return { blkSz, totalBlks, totalChunks, chunks, u8 };
}

/** Partition source chunks into sub-images each <= maxDownload bytes. */
export function planResparse(parsed: ParsedSparse, maxDownload: number): ResparsePlan {
  const { blkSz, totalBlks, chunks } = parsed;
  if (!(maxDownload > 0)) throw new Error("sparse: maxDownload must be > 0");
  const minNeeded = FILE_HDR_SZ + CHUNK_HDR_SZ + blkSz; // leading DONT_CARE only adds 12
  if (maxDownload < minNeeded + CHUNK_HDR_SZ)
    throw new Error(
      "sparse: maxDownload " + maxDownload + " too small for one block (need >= " +
        (minNeeded + CHUNK_HDR_SZ) + ")",
    );

  const subimages: SubImage[] = [];
  let cur: SubImage | null = null;
  let blockCursor = 0;

  const startNew = (): SubImage => {
    let size = FILE_HDR_SZ;
    if (blockCursor > 0) size += CHUNK_HDR_SZ; // leading DONT_CARE
    cur = { startBlock: blockCursor, items: [], size };
    subimages.push(cur);
    return cur;
  };

  for (const ch of chunks) {
    if (ch.type === CHUNK_TYPE_DONT_CARE) {
      if (cur && cur.items.length && cur.size + CHUNK_HDR_SZ <= maxDownload) {
        cur.items.push({ type: CHUNK_TYPE_DONT_CARE, blocks: ch.blocks, dataOff: 0, dataLen: 0 });
        cur.size += CHUNK_HDR_SZ;
      } else {
        cur = null;
      }
      blockCursor += ch.blocks;
      continue;
    }

    if (ch.type === CHUNK_TYPE_RAW) {
      let remaining = ch.blocks;
      let payloadOff = ch.dataOff;
      while (remaining > 0) {
        if (!cur) cur = startNew();
        const avail = maxDownload - cur.size - CHUNK_HDR_SZ;
        const maxBlks = Math.floor(avail / blkSz);
        if (maxBlks < 1) { cur = null; continue; }
        const take = Math.min(remaining, maxBlks);
        cur.items.push({ type: CHUNK_TYPE_RAW, blocks: take, dataOff: payloadOff, dataLen: take * blkSz });
        cur.size += CHUNK_HDR_SZ + take * blkSz;
        payloadOff += take * blkSz;
        blockCursor += take;
        remaining -= take;
        if (remaining > 0) cur = null;
      }
      continue;
    }

    // FILL / CRC32: atomic 4-byte-payload chunks (build never emits these).
    const cost = CHUNK_HDR_SZ + ch.dataLen;
    if (!cur || cur.size + cost > maxDownload) cur = startNew();
    cur.items.push({ type: ch.type, blocks: ch.blocks, dataOff: ch.dataOff, dataLen: ch.dataLen });
    cur.size += cost;
    blockCursor += ch.blocks;
  }

  if (blockCursor > totalBlks)
    throw new Error("sparse: chunk block coverage " + blockCursor + " exceeds total_blks " + totalBlks);
  return { totalBlks, blkSz, subimages };
}

/** Materialize one planned sub-image into a Uint8Array of exactly plan.size bytes. */
function buildSubimage(parsed: ParsedSparse, plan: SubImage, _totalBlks: number, blkSz: number): Uint8Array {
  const out = new Uint8Array(plan.size);
  const dv = new DataView(out.buffer);
  const hasLead = plan.startBlock > 0;
  const totalChunks = plan.items.length + (hasLead ? 1 : 0);

  // A sub-image's total_blks must equal the blocks THIS sub-image accounts for —
  // the leading DONT_CARE (startBlock) plus its own chunk blocks — NOT the full
  // image's block count. U-Boot's sparse writer (lib/image-sparse.c) sums every
  // chunk's chunk_sz and fails with "sparse image write failure" if that running
  // total != the header's total_blks. Writing the full count only balanced when
  // there was a single sub-image spanning the whole image; a 2+ way split (payload
  // > device max-download-size) made every non-final sub-image over-declare and
  // fail. This matches AOSP libsparse's sparse_file_resparse: no trailing skip,
  // header total = offset + data blocks. (Blocks not covered here are holes a
  // later sub-image — or nothing — fills; ext4's size lives in its superblock.)
  let coveredBlks = plan.startBlock;
  for (const it of plan.items) coveredBlks += it.blocks;

  dv.setUint32(0, SPARSE_MAGIC, true);
  dv.setUint16(4, MAJOR_VERSION, true);
  dv.setUint16(6, MINOR_VERSION, true);
  dv.setUint16(8, FILE_HDR_SZ, true);
  dv.setUint16(10, CHUNK_HDR_SZ, true);
  dv.setUint32(12, blkSz, true);
  dv.setUint32(16, coveredBlks, true); // blocks THIS sub-image covers (offset + data)
  dv.setUint32(20, totalChunks, true);
  dv.setUint32(24, 0, true); // image_checksum

  let off = FILE_HDR_SZ;
  const writeChunkHdr = (type: number, blocks: number, dataLen: number) => {
    dv.setUint16(off, type, true);
    dv.setUint16(off + 2, 0, true); // reserved
    dv.setUint32(off + 4, blocks, true); // chunk_sz (blocks)
    dv.setUint32(off + 8, CHUNK_HDR_SZ + dataLen, true); // total_sz (bytes)
    off += CHUNK_HDR_SZ;
  };

  if (hasLead) writeChunkHdr(CHUNK_TYPE_DONT_CARE, plan.startBlock, 0);

  for (const it of plan.items) {
    writeChunkHdr(it.type, it.blocks, it.dataLen);
    if (it.dataLen > 0) {
      out.set(parsed.u8.subarray(it.dataOff, it.dataOff + it.dataLen), off);
      off += it.dataLen;
    }
  }
  return out;
}

/** Resparse a complete sparse image and flash the sub-images to `partition`. */
export async function flashSparse(
  fb: Fastboot,
  partition: string,
  simgBuffer: Uint8Array,
  { onProgress, onInfo }: { onProgress?: ProgressCb; onInfo?: InfoCb } = {},
): Promise<{ subimages: number; totalBytes: number }> {
  const maxDownload = fb.maxDownload;
  if (!maxDownload) throw new Error("flashSparse: fb.maxDownload unset — call identify() first");

  const parsed = parseSparse(simgBuffer);
  const plan = planResparse(parsed, maxDownload);
  const subimages = plan.subimages;

  let totalBytes = 0;
  for (const s of subimages) totalBytes += s.size;
  let done = 0;

  for (let i = 0; i < subimages.length; i++) {
    const sub = subimages[i]!;
    const img = buildSubimage(parsed, sub, plan.totalBlks, plan.blkSz);
    if (img.byteLength > maxDownload)
      throw new Error(
        "flashSparse: sub-image " + i + " is " + img.byteLength +
          " B > max-download-size " + maxDownload + " B",
      );
    const base = done;
    await fb.download(img, (d) => { if (onProgress) onProgress(base + d, totalBytes); });
    done = base + img.byteLength;
    if (onProgress) onProgress(done, totalBytes);
    await fb.command("flash:" + partition, onInfo);
  }
  return { subimages: subimages.length, totalBytes };
}

// Test-only surface: the device-side block-accounting check lives in buildSubimage,
// and sparse.test.ts reproduces U-Boot's acceptance rule against real images.
export { SPARSE_MAGIC, buildSubimage as __buildSubimageForTest };
