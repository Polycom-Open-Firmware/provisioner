// SPDX-License-Identifier: GPL-2.0-or-later

// uboot-console.ts — drive the stock U-Boot console over an injected
// SerialTransport. Ported from the prompt-handling in the pathfinder
// `provision-tool/src/enroll.js` (catchPrompt/uCmd) + serial.js semantics. The
// raw link (open/send/readUntil/drain) is the SerialTransport; this adds the
// command/prompt layer the enroll flow needs.
import type { SerialTransport } from "../transport/transport";
import { sleep } from "../transport/transport";

export const PROMPT = "=>";

export type LogCb = (msg: string) => void;

export class UBootConsole {
  readonly serial: SerialTransport;

  constructor(serial: SerialTransport) {
    this.serial = serial;
  }

  get connected(): boolean {
    return this.serial.connected;
  }

  /**
   * Run one U-Boot command: drain stale output, send it, read to the next '=>',
   * and (unless told otherwise) fail on the obvious error words.
   */
  async cmd(
    c: string,
    { expectOk = true, timeoutMs = 12000 }: { expectOk?: boolean; timeoutMs?: number } = {},
  ): Promise<string> {
    this.serial.drain(); // ignore stale prompts -> wait for THIS command's
    await this.serial.send(c);
    const out = await this.serial.readUntil(PROMPT, timeoutMs);
    const low = out.toLowerCase();
    if (
      expectOk &&
      (low.includes("error") || low.includes("bad ") ||
        low.includes("fail") || low.includes("not found"))
    )
      throw new Error("command failed: " + JSON.stringify(c) + "\n" + out);
    return out;
  }

  /** Send raw bytes (e.g. Ctrl-C = 0x03 to break out of fastboot). */
  async sendRaw(bytes: number[] | Uint8Array): Promise<void> {
    await this.serial.writeRaw(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  /** Wait for a banner/needle on the console (e.g. the stage-2 U-Boot version). */
  async waitFor(needle: string, timeoutMs = 20000): Promise<string> {
    return this.serial.readUntil(needle, timeoutMs);
  }

  /**
   * Spam bare CRs until the stock U-Boot '=>' prompt answers. The operator is
   * told to power-cycle the unit so the boot countdown can be interrupted.
   */
  async catchPrompt(
    log: LogCb = () => {},
    tries = 400,
    message = "catching U-Boot prompt -- power-cycle the unit now if it's off...",
  ): Promise<boolean> {
    log(message);
    const esc = (s: string) => s.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    const diag = () => (this.serial.debugInfo ? " [" + this.serial.debugInfo() + "]" : "");
    let seen = ""; // everything the port emitted while we were spamming CRs
    let announced = false; // logged the first-bytes-arrived signal yet?
    for (let i = 0; i < tries; i++) {
      await this.serial.send(""); // bare CR
      const out = await this.serial.readUntil(PROMPT, 250);
      if (out.includes(PROMPT)) {
        await sleep(400); // let queued CR-echoes flush in
        this.serial.drain(); // then discard ALL the stale prompts
        log("got prompt.");
        return true;
      }
      seen += out;
      // Stream the single most useful signal the moment it's knowable: is RX alive
      // at all? (dead RX => signals/wiring/baud; live RX w/o '=>' => prompt mismatch.)
      if (!announced && seen.length > 0) {
        announced = true;
        log("receiving serial data (RX is alive): " + JSON.stringify(esc(seen.slice(-120))));
      }
      // Heartbeat every ~10 s so a long catch isn't a silent wall.
      if (i > 0 && i % 40 === 0)
        log("still catching prompt… try " + i + "/" + tries + ", " + seen.length + " byte(s) seen so far" +
          (seen.length === 0 ? " (nothing on RX yet — power-cycle now)" : "") + diag());
    }
    // Final verdict, so a failed catch is actionable rather than just "retry".
    if (seen.length === 0) {
      log("NO serial data received on RX across " + tries + " tries — the link is one-way or dead." + diag() +
        " Native works on this port, so if this is the web flavor: make sure nothing else holds the COM " +
        "(native app / picocom / forwarder), and the port isn't being consumed by a bridge.");
    } else {
      log("received " + seen.length + " byte(s) but never matched the '" + PROMPT +
        "' prompt — likely a different prompt string. Last bytes: " + JSON.stringify(esc(seen.slice(-200))));
    }
    return false;
  }
}
