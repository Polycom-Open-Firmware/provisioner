// SPDX-License-Identifier: GPL-2.0-or-later

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
  // --- diagnostics (surfaced via debugInfo() into the Status Log) -------------
  private rxBytes = 0; // total raw bytes the read loop has pulled off RX
  private loopState: "not-started" | "running" | "ended" = "not-started";
  private loopErr: string | null = null; // a thrown error inside the read loop
  private signalState = "n/a"; // outcome of the DTR/RTS assertion on open

  get connected(): boolean {
    return !!this.port;
  }

  /** Adapter self-report for the Status Log — makes "no comms" diagnosable. */
  debugInfo(): string {
    return (
      "webserial: rx=" + this.rxBytes + "B, readLoop=" +
      (this.loopErr ? "ERROR " + this.loopErr : this.loopState) +
      ", dtr/rts=" + this.signalState
    );
  }

  async open(opts: { baudRate?: number; path?: string } = {}): Promise<void> {
    // `path` is native-only; the browser always prompts with its own chooser.
    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: opts.baudRate ?? 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
    });
    // Assert DTR + RTS the way picocom/screen do by default. Chrome's Web Serial
    // opens with these DEASSERTED, which on some USB-serial + level-shifter chains
    // leaves the link dead (RX never arrives) even though the exact same port works
    // in picocom. The U-Boot console has no DTR/RTS auto-reset circuit, so asserting
    // both is safe. Best-effort: not every platform implements setSignals.
    try {
      await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
      this.signalState = "asserted";
    } catch (e) {
      this.signalState = "setSignals-failed(" + ((e as Error)?.message ?? e) + ")";
      console.warn("[webserial] setSignals failed:", e);
    }
    this.writer = this.port.writable!.getWriter();
    this.run = true;
    console.info("[webserial] opened", { baudRate: opts.baudRate ?? 115200, signals: this.signalState });
    void this.readLoop();
  }

  async setSignals(s: { dtr?: boolean; rts?: boolean; brk?: boolean }): Promise<void> {
    await this.port?.setSignals({
      ...(s.dtr !== undefined ? { dataTerminalReady: s.dtr } : {}),
      ...(s.rts !== undefined ? { requestToSend: s.rts } : {}),
      ...(s.brk !== undefined ? { break: s.brk } : {}),
    });
  }

  private async readLoop(): Promise<void> {
    try {
      // getReader() throws if `readable` is null (port not readable / already
      // locked) — capture that instead of silently reading nothing forever.
      this.reader = this.port!.readable!.getReader();
      this.loopState = "running";
      while (this.run) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.byteLength) {
          this.rxBytes += value.byteLength;
          this.rx += dec.decode(value, { stream: true });
        }
      }
      this.loopState = "ended";
    } catch (e) {
      this.loopErr = (e as Error)?.message ?? String(e);
      console.error("[webserial] read loop error:", e);
    } finally {
      try { this.reader?.releaseLock(); } catch { /* noop */ }
    }
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
