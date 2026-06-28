// serial.ts — Web Serial implementation of core's SerialTransport. Ported from
// the pathfinder `provision-tool/src/serial.js` (SerialLink). Chromium only,
// secure context. The native flavor provides the same interface over the Rust
// `serialport` crate (and can implement setSignals for DTR/RTS/BREAK).
import type { SerialTransport } from "@provisioner/core";

const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WebSerialTransport implements SerialTransport {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private rx = "";
  private cursor = 0;
  private run = false;

  get connected(): boolean {
    return !!this.port;
  }

  async open(opts: { baudRate?: number } = {}): Promise<void> {
    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: opts.baudRate ?? 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
    });
    this.writer = this.port.writable!.getWriter();
    this.run = true;
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    this.reader = this.port!.readable!.getReader();
    try {
      while (this.run) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.rx += dec.decode(value, { stream: true });
      }
    } catch { /* port closed */ }
    finally { try { this.reader.releaseLock(); } catch { /* noop */ } }
  }

  async send(line: string): Promise<void> {
    await this.writer!.write(enc.encode(line + "\r"));
  }

  async writeRaw(bytes: Uint8Array): Promise<void> {
    await this.writer!.write(bytes);
  }

  drain(): void {
    this.cursor = this.rx.length;
  }

  async readUntil(needle: string, timeoutMs = 8000): Promise<string> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const i = this.rx.indexOf(needle, this.cursor);
      if (i >= 0) {
        const out = this.rx.slice(this.cursor, i + needle.length);
        this.cursor = i + needle.length;
        return out;
      }
      await sleep(40);
    }
    const out = this.rx.slice(this.cursor);
    this.cursor = this.rx.length;
    return out;
  }

  async close(): Promise<void> {
    this.run = false;
    try { await this.reader?.cancel(); } catch { /* noop */ }
    try { this.writer?.releaseLock(); } catch { /* noop */ }
    try { await this.port?.close(); } catch { /* noop */ }
    this.port = null;
  }
}
