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
  private openOpts = { baudRate: 115200 };
  // --- diagnostics (surfaced via debugInfo() into the Status Log) -------------
  private rxBytes = 0; // total raw bytes the read loop has pulled off RX
  private loopState: "not-started" | "running" | "recovered" | "lost" | "ended" = "not-started";
  private loopErr: string | null = null; // a thrown error inside the read loop
  private signalState = "n/a"; // outcome of the DTR/RTS assertion on open
  private reconnects = 0; // times we transparently reopened after a device loss

  get connected(): boolean {
    return !!this.port;
  }

  /** Adapter self-report for the Status Log — makes "no comms" diagnosable. */
  debugInfo(): string {
    return (
      "webserial: rx=" + this.rxBytes + "B, readLoop=" +
      (this.loopErr ? "ERROR " + this.loopErr : this.loopState) +
      ", reconnects=" + this.reconnects + ", dtr/rts=" + this.signalState
    );
  }

  async open(opts: { baudRate?: number; path?: string } = {}): Promise<void> {
    // `path` is native-only; the browser always prompts with its own chooser.
    // Release any port we still hold from a prior attempt so a retry doesn't fail
    // with "The port is already open".
    if (this.port) { try { await this.close(); } catch { /* noop */ } }

    const port = await navigator.serial.requestPort();
    this.port = port;
    this.openOpts = { baudRate: opts.baudRate ?? 115200 };
    try {
      await this.openPort();
    } catch (e) {
      // Normalize the browser's vague open failure into an operator-actionable
      // message. A busy port — something else still holding it — is by far the
      // most common cause, so name it and say what to do.
      this.port = null;
      const name = (e as { name?: string })?.name ?? "";
      const msg = (e as Error)?.message ?? String(e);
      const busy = name === "InvalidStateError" ||
        /already open|in use|access is denied|failed to open|networkerror|unknown/i.test(msg);
      throw new Error(
        busy
          ? "Serial port is in use. Close anything else using it — the native app, " +
            "PuTTY/picocom, or a COM-port forwarder — then choose the port again."
          : "Could not open the serial port: " + msg,
      );
    }
    this.run = true;
    console.info("[webserial] opened", { baudRate: this.openOpts.baudRate, signals: this.signalState });
    void this.readSupervisor();
  }

  /** (Re)open the granted port: stream config, DTR/RTS, fresh writer. Used by the
   *  initial open AND by recovery after a transient device loss (same SerialPort
   *  object — its permission persists, so no chooser is needed). */
  private async openPort(): Promise<void> {
    await this.port!.open({
      baudRate: this.openOpts.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
    });
    // Assert DTR + RTS the way picocom/screen do by default (Chrome opens them
    // deasserted). Harmless on the U-Boot console (no auto-reset circuit).
    try {
      await this.port!.setSignals({ dataTerminalReady: true, requestToSend: true });
      this.signalState = "asserted";
    } catch (e) {
      this.signalState = "setSignals-failed(" + ((e as Error)?.message ?? e) + ")";
      console.warn("[webserial] setSignals failed:", e);
    }
    this.writer = this.port!.writable!.getWriter();
  }

  async setSignals(s: { dtr?: boolean; rts?: boolean; brk?: boolean }): Promise<void> {
    await this.port?.setSignals({
      ...(s.dtr !== undefined ? { dataTerminalReady: s.dtr } : {}),
      ...(s.rts !== undefined ? { requestToSend: s.rts } : {}),
      ...(s.brk !== undefined ? { break: s.brk } : {}),
    });
  }

  /**
   * Owns the read loop AND transparent recovery. A USB serial adapter routinely
   * drops mid-flow — the unlock flow even *requires* a power-cycle right after
   * opening serial, and WSL/usbip forwarding drops the device on its own. Web
   * Serial surfaces that as reader.read() rejecting ("The device has been lost").
   * Instead of dying permanently, we reopen the same granted port when it returns
   * and resume, so catchPrompt (which spans the outage) simply continues.
   */
  private async readSupervisor(): Promise<void> {
    while (this.run) {
      try {
        this.loopState = this.reconnects ? "recovered" : "running";
        this.reader = this.port!.readable!.getReader();
        try {
          while (this.run) {
            const { value, done } = await this.reader.read();
            if (done) break; // stream closed under us -> fall through to recovery
            if (value && value.byteLength) {
              this.rxBytes += value.byteLength;
              this.rx += dec.decode(value, { stream: true });
            }
          }
        } finally {
          try { this.reader?.releaseLock(); } catch { /* noop */ }
        }
      } catch (e) {
        this.loopErr = (e as Error)?.message ?? String(e);
        console.error("[webserial] read loop error:", e);
      }
      if (!this.run) break;
      if (!(await this.recover())) { this.loopState = "lost"; break; }
    }
    if (this.run) this.loopState = "ended";
  }

  /** Reopen the port after a loss. Returns false if it doesn't come back in ~30 s
   *  (comfortably longer than a power-cycle), so we don't spin forever. */
  private async recover(): Promise<boolean> {
    try { this.writer?.releaseLock(); } catch { /* noop */ }
    this.writer = null;
    try { await this.port?.close(); } catch { /* already gone */ }
    for (let i = 0; i < 100 && this.run; i++) {
      await sleep(300);
      try {
        await this.openPort();
        this.reconnects++;
        this.loopErr = null;
        console.info("[webserial] serial recovered (reconnect #" + this.reconnects + ")");
        return true;
      } catch { /* device not back yet — keep waiting */ }
    }
    this.loopErr = "device lost and did not return within ~30s";
    return false;
  }

  async send(line: string): Promise<void> {
    // Skip (don't throw) while the port is dropped/recovering — the caller (e.g.
    // catchPrompt) retries, and comms resume once the port reopens.
    if (!this.writer) return;
    try { await this.writer.write(enc.encode(line + "\r")); }
    catch { /* write raced a device drop; recovery will reopen */ }
  }

  async writeRaw(bytes: Uint8Array): Promise<void> {
    if (!this.writer) return;
    try { await this.writer.write(bytes); }
    catch { /* write raced a device drop; recovery will reopen */ }
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
    this.run = false; // stops the supervisor + any in-flight recovery loop
    try { await this.reader?.cancel(); } catch { /* noop */ }
    try { this.writer?.releaseLock(); } catch { /* noop */ }
    try { await this.port?.close(); } catch { /* noop */ }
    this.port = null;
  }
}
