// SPDX-License-Identifier: GPL-2.0-or-later

// sdp.ts — the i.MX Serial Download Protocol (SDP), transport-agnostic. Drives the
// BootROM (and the SPL's "SDPV" download gadget) over an injected HidTransport to
// load a bootloader into RAM — the browser-native replacement for `uuu -b spl`.
//
// PROVEN on a real Polycom C60 (i.MX8MM) end-to-end via WebHID: stage 1 loads the
// SPL (DDR init), stage 2 loads the U-Boot FIT to the text base, ATF runs, and
// U-Boot boots to a prompt + fastboot — zero install, no uuu, no driver.
//
// Constants/structs transcribed from mfgtools libuuu/sdp.{h,cpp}; the two-stage
// geometry + the FIT load address were confirmed against the C60 build.
import type { HidTransport } from "../transport/transport";

// ---- protocol constants (libuuu/sdp.h) ----------------------------------------
export const SDP_VID = 0x1fc9;
export const SDP_PID_BOOTROM = 0x0134; // i.MX8MM BootROM in SDP mode
export const SDP_PID_SPL = 0x0151; // the SPL's "SDPV" download gadget (confirmed on C60)

const CMD_WR_FILE = 0x0404;
const CMD_JUMP_ADDR = 0x0b0b;

const ROM_WRITE_ACK = 0x128a8a12;
const ROM_STATUS_ACK = 0x88888888;
const ROM_OK_ACK = 0x900dd009;

const IVT_BARKER = 0x402000d1;
const IVT_BARKER2 = 0x412000d1;

// HID report ids: OUTPUT 1 = command, 2 = data; INPUT 3 = HAB, 4 = status.
const R_CMD = 1;
const R_DATA = 2;
const R_HAB = 3;
const R_STATUS = 4;
const DATA_CHUNK = 1024; // SDP HID data report payload size

/** i.MX8MM U-Boot text base — `CONFIG_TEXT_BASE` / imx-mkimage `-second_loader …
 *  0x40200000`. The u-boot.itb FIT loads here; the SPL's FIT loader unpacks bl31 +
 *  U-Boot. TODO(c60): make configurable per build/SoC once a 2nd device appears. */
export const UBOOT_TEXT_BASE = 0x40200000;

// ---- flash.bin parsing --------------------------------------------------------
export interface Ivt {
  fileOff: number;
  entry: number;
  bootData: number;
  selfAddr: number;
}
export interface BootData {
  imageStart: number;
  imageSize: number;
}

function rd32(buf: Uint8Array, o: number): number {
  return o >= 0 && o + 4 <= buf.length
    ? (buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16) | (buf[o + 3]! << 24)) >>> 0
    : NaN;
}

/** Scan for the IVT barker on 4-byte alignment within `limit` bytes of `from`. */
export function findIvt(buf: Uint8Array, from: number, limit: number): Ivt | null {
  const end = Math.min(from + limit, buf.length);
  for (let o = from; o + 32 <= end; o += 4) {
    const b = rd32(buf, o);
    if (b === IVT_BARKER || b === IVT_BARKER2)
      return { fileOff: o, entry: rd32(buf, o + 4), bootData: rd32(buf, o + 16), selfAddr: rd32(buf, o + 20) };
  }
  return null;
}

export function readBootData(buf: Uint8Array, ivt: Ivt): BootData | null {
  const foff = ivt.fileOff + (ivt.bootData - ivt.selfAddr);
  if (foff < 0 || foff + 12 > buf.length) return null;
  return { imageStart: rd32(buf, foff), imageSize: rd32(buf, foff + 4) };
}

/** SPL image byte length: `ImageSize - (SelfAddr - ImageStartAddr)` (libuuu). */
export function splImageLen(ivt: Ivt, bd: BootData): number {
  return Math.max(0, bd.imageSize - (ivt.selfAddr - bd.imageStart));
}

/** First FDT/FIT magic (0xd00dfeed, big-endian) at/after `from` — the u-boot.itb. */
export function findFitMagic(buf: Uint8Array, from: number): number {
  for (let i = from; i + 4 <= buf.length; i++)
    if (buf[i] === 0xd0 && buf[i + 1] === 0x0d && buf[i + 2] === 0xfe && buf[i + 3] === 0xed) return i;
  return -1;
}

// ---- SDP over HID -------------------------------------------------------------
function encodeCmd(cmd: number, addr: number, count: number): Uint8Array {
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, cmd, false); // big-endian (libuuu EndianSwap)
  dv.setUint32(2, addr, false);
  b[6] = 0; // format
  dv.setUint32(7, count, false);
  dv.setUint32(11, 0, false); // data
  b[15] = 0; // rsvd
  return b;
}

/** Drives SDP over an injected HidTransport. The runner (re)points `hid` at the
 *  BootROM for stage 1 and the SPL gadget for stage 2 via its gesture handlers. */
export class Sdp {
  readonly hid: HidTransport;
  constructor(hid: HidTransport) {
    this.hid = hid;
  }
  get connected(): boolean {
    return this.hid.connected;
  }

  private async writeFile(addr: number, bytes: Uint8Array): Promise<void> {
    await this.hid.sendReport(R_CMD, encodeCmd(CMD_WR_FILE, addr, bytes.length));
    // This silicon sends no HAB report before the data on WRITE_FILE — stream now.
    for (let i = 0; i < bytes.length; i += DATA_CHUNK) {
      let chunk = bytes.subarray(i, i + DATA_CHUNK);
      if (chunk.length < DATA_CHUNK) {
        const p = new Uint8Array(DATA_CHUNK);
        p.set(chunk);
        chunk = p;
      }
      await this.hid.sendReport(R_DATA, chunk);
    }
    const st = await this.hid.readReport(R_STATUS, 20000);
    const ack = new DataView(st.buffer, st.byteOffset).getUint32(0, true);
    if (ack !== ROM_WRITE_ACK && ack !== ROM_STATUS_ACK && ack !== ROM_OK_ACK)
      throw new Error("SDP WRITE_FILE not acked (got 0x" + (ack >>> 0).toString(16) + ")");
  }

  private async jump(addr: number): Promise<void> {
    await this.hid.sendReport(R_CMD, encodeCmd(CMD_JUMP_ADDR, addr, 0));
    // The device jumps; a HAB report may or may not arrive — don't block on it.
    try { await this.hid.readReport(R_HAB, 2000); } catch { /* expected */ }
  }

  /** Stage 1 (BootROM): load the SPL from the head of flash.bin and jump to it. */
  async bootSpl(flash: Uint8Array, log: (m: string) => void): Promise<void> {
    const ivt = findIvt(flash, 0, 0x100000);
    if (!ivt) throw new Error("no IVT (0x402000D1) at the head of flash.bin");
    const bd = readBootData(flash, ivt);
    if (!bd) throw new Error("no SPL BootData");
    const len = splImageLen(ivt, bd);
    log("loading SPL (" + len + " B) to 0x" + ivt.selfAddr.toString(16));
    await this.writeFile(ivt.selfAddr, flash.subarray(ivt.fileOff, ivt.fileOff + len));
    await this.jump(ivt.selfAddr);
    log("SPL jumped — it brings up DDR and re-enumerates as the download gadget.");
  }

  /** Stage 2 (SPL SDPV): load the U-Boot FIT to the text base and jump so the
   *  SPL's FIT loader unpacks bl31 + U-Boot. */
  async bootUboot(flash: Uint8Array, log: (m: string) => void): Promise<void> {
    const ivt = findIvt(flash, 0, 0x100000);
    const bd = ivt && readBootData(flash, ivt);
    const from = ivt && bd ? ivt.fileOff + splImageLen(ivt, bd) : 0;
    const fit = findFitMagic(flash, from);
    if (fit < 0) throw new Error("no U-Boot FIT (0xd00dfeed) found after the SPL");
    log("loading U-Boot FIT (" + (flash.length - fit) + " B) to 0x" + UBOOT_TEXT_BASE.toString(16));
    await this.writeFile(UBOOT_TEXT_BASE, flash.subarray(fit));
    await this.jump(UBOOT_TEXT_BASE);
    log("U-Boot jumped — ATF + U-Boot boot; the device will enter fastboot.");
  }
}
