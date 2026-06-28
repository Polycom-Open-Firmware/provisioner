// fastboot.ts — fastboot protocol over an injected UsbTransport. Ported from the
// pathfinder `provision-tool/src/fastboot.js`; the WebUSB calls are gone — this
// class only ever touches `usb.bulkOut/bulkIn`, so the SAME code runs on the web
// adapter (WebUSB) and the native adapter (Tauri → Rust nusb).
//
// Protocol refs: AOSP fastboot, U-Boot fastboot. Gadget: interface class 0xff /
// sub 0x42 / proto 0x03, two bulk endpoints, single fastboot function.
import type { UsbFilter, UsbTransport, InterfaceMatch } from "../transport/transport";

// requestDevice filters: our stage-2 (1fc9:0152), stock gadget (0525:a4a5,
// already WinUSB-bound — handy for testing), and any fastboot-class interface.
export const FASTBOOT_FILTERS: UsbFilter[] = [
  { vendorId: 0x1fc9, productId: 0x0152 },
  { vendorId: 0x0525, productId: 0xa4a5 },
  { classCode: 0xff, subclassCode: 0x42, protocolCode: 0x03 },
];

// The interface the adapter should claim once the device is open.
export const FASTBOOT_INTERFACE: InterfaceMatch = {
  classCode: 0xff,
  subclassCode: 0x42,
  protocolCode: 0x03,
};

const TEXT = new TextDecoder();
const ENC = new TextEncoder();

export type InfoCb = (msg: string) => void;
export type ProgressCb = (done: number, total: number) => void;

/** Result of a download: phase request — the device's accepted byte count. */
interface DataPhase {
  dataPhase: number;
}

export class Fastboot {
  readonly usb: UsbTransport;
  maxDownload = 0;

  constructor(usb: UsbTransport) {
    this.usb = usb;
  }

  get connected(): boolean {
    return this.usb.connected;
  }

  /** Open the fastboot gadget and identify it. `serial` targets a specific device (native). */
  async connect(filters: UsbFilter[] = FASTBOOT_FILTERS, serial?: string) {
    await this.usb.open(filters, FASTBOOT_INTERFACE, { serial });
    return this.identify();
  }

  async disconnect(): Promise<void> {
    await this.usb.close();
  }

  // --- wire protocol ---------------------------------------------------------

  /** Send one command (<=64 bytes) and read the terminal response. */
  async command(cmd: string, onInfo?: InfoCb): Promise<string> {
    await this.usb.bulkOut(ENC.encode(cmd));
    const r = await this._readResponse(onInfo);
    if (typeof r !== "string")
      throw new Error("fastboot: unexpected DATA response to '" + cmd + "'");
    return r;
  }

  private async _readResponse(onInfo?: InfoCb): Promise<string | DataPhase> {
    // INFO lines accumulate; OKAY resolves; FAIL throws; DATA returned raw.
    for (;;) {
      const buf = await this.usb.bulkIn(64);
      const tag = TEXT.decode(buf.slice(0, 4));
      const rest = TEXT.decode(buf.slice(4));
      switch (tag) {
        case "OKAY":
          return rest;
        case "FAIL":
          throw new Error("fastboot FAIL: " + rest);
        case "INFO":
          if (onInfo) onInfo(rest);
          break;
        case "DATA":
          return { dataPhase: parseInt(rest.slice(0, 8), 16) };
        default:
          throw new Error("unexpected fastboot response: " + tag + rest);
      }
    }
  }

  async getvar(name: string, onInfo?: InfoCb): Promise<string> {
    return this.command("getvar:" + name, onInfo);
  }

  private async _send(cmd: string): Promise<void> {
    await this.usb.bulkOut(ENC.encode(cmd));
  }

  /** Download a buffer into the device fastboot buffer. */
  async download(data: Uint8Array, onProgress?: ProgressCb): Promise<string> {
    const size = data.byteLength;
    if (this.maxDownload && size > this.maxDownload)
      throw new Error(
        "artifact " + size + " B exceeds device max-download-size " +
          this.maxDownload + " B — needs a sparse image.",
      );
    await this._send("download:" + size.toString(16).padStart(8, "0"));
    const r = await this._readResponse();
    if (!(typeof r === "object" && r.dataPhase === size))
      throw new Error("download: device rejected size (" + JSON.stringify(r) + ")");
    const CHUNK = 16384;
    for (let off = 0; off < size; off += CHUNK) {
      const end = Math.min(off + CHUNK, size);
      await this.usb.bulkOut(data.subarray(off, end));
      if (onProgress) onProgress(end, size);
    }
    const done = await this._readResponse();
    if (typeof done !== "string")
      throw new Error("download: missing terminal OKAY");
    return done;
  }

  /** Download then flash to a named partition (GPT name or env raw partition). */
  async flash(
    partition: string,
    data: Uint8Array,
    onProgress?: ProgressCb,
    onInfo?: InfoCb,
  ): Promise<string> {
    await this.download(data, onProgress);
    return this.command("flash:" + partition, onInfo);
  }

  /** UUU command channel — run a U-Boot command on the device. */
  async ucmd(cmd: string, onInfo?: InfoCb): Promise<string> {
    return this.command("UCmd:" + cmd, onInfo);
  }

  /** Repartition the user-area eMMC (option-B fallback; pins part 1 >= 16 MiB). */
  async gptWrite(layout: string, onInfo?: InfoCb): Promise<string> {
    return this.ucmd('gpt write mmc 0 "' + layout + '"', onInfo);
  }

  /** Define an env-backed raw fastboot partition (in-gap stage2/bmp regions). */
  async defineRawPartition(
    name: string,
    startLBA: number,
    sizeLBA: number,
    onInfo?: InfoCb,
  ): Promise<string> {
    return this.ucmd(
      "setenv fastboot_raw_partition_" + name +
        " 0x" + startLBA.toString(16) + " 0x" + sizeLBA.toString(16),
      onInfo,
    );
  }

  async setActive(slot: string, onInfo?: InfoCb): Promise<string> {
    return this.command("set_active:" + slot, onInfo);
  }

  async reboot(): Promise<string> {
    await this._send("reboot");
    const r = await this._readResponse();
    if (typeof r !== "string") throw new Error("reboot: unexpected DATA response");
    return r;
  }

  /** Identify a unit: the vars the provisioning wizard gates on. */
  async identify(): Promise<Record<string, string | number>> {
    const vars = [
      "product", "serialno", "version-bootloader", "max-download-size",
      "version", "secure", "partition-type:rootfs",
    ];
    const out: Record<string, string | number> = {};
    for (const v of vars) {
      try {
        out[v] = await this.getvar(v);
      } catch (e) {
        out[v] = "(" + (e as Error).message + ")";
      }
    }
    const md = out["max-download-size"];
    if (typeof md === "string") {
      const n = parseInt(md, 16);
      if (!Number.isNaN(n)) {
        out["max-download-size-bytes"] = n;
        this.maxDownload = n;
      }
    }
    return out;
  }
}
