// SPDX-License-Identifier: GPL-2.0-or-later

// serial.ts — native (Tauri) implementation of core's SerialTransport. The Rust
// backend runs a reader thread that buffers incoming bytes; readUntil polls
// `serial_read` to drain that buffer, mirroring the web adapter's buffering so the
// U-Boot console driver in core behaves identically.
import { invoke } from "@tauri-apps/api/core";
import type { SerialTransport } from "@provisioner/core";

const dec = new TextDecoder();
const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NativeSerialTransport implements SerialTransport {
  private isOpen = false;
  private rx = "";
  private cursor = 0;

  get connected(): boolean {
    return this.isOpen;
  }

  async open(opts: { baudRate?: number; path?: string } = {}): Promise<void> {
    await invoke("serial_open", { baudRate: opts.baudRate ?? 115200, path: opts.path ?? null });
    this.isOpen = true;
  }

  private async pump(): Promise<void> {
    const bytes = await invoke<number[]>("serial_read");
    if (bytes && bytes.length) this.rx += dec.decode(new Uint8Array(bytes), { stream: true });
  }

  async send(line: string): Promise<void> {
    await invoke("serial_write", { data: Array.from(enc.encode(line + "\r")) });
  }

  async writeRaw(bytes: Uint8Array): Promise<void> {
    await invoke("serial_write", { data: Array.from(bytes) });
  }

  drain(): void {
    this.cursor = this.rx.length;
  }

  async readUntil(needle: string, timeoutMs = 8000): Promise<string> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await this.pump();
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

  async setSignals(s: { dtr?: boolean; rts?: boolean; brk?: boolean }): Promise<void> {
    await invoke("serial_signals", { dtr: s.dtr ?? null, rts: s.rts ?? null, brk: s.brk ?? null });
  }

  async close(): Promise<void> {
    await invoke("serial_close");
    this.isOpen = false;
  }
}
