// SPDX-License-Identifier: GPL-2.0-or-later

// hid.ts — WebHID implementation of core's HidTransport. Carries the i.MX SDP
// protocol to the BootROM's HID vendor interface (usage page 0xFF00), which WebUSB
// can't claim but WebHID can — no driver install. Proven on the C60. The native
// flavor would provide the same interface over Rust hidapi/nusb.
import type { DeviceInfo, HidFilter, HidTransport } from "@provisioner/core";

export class WebHidTransport implements HidTransport {
  private device: HIDDevice | null = null;
  private inbox: { id: number; data: Uint8Array }[] = []; // received input reports
  private waiters: { id: number; resolve: (d: Uint8Array) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  info: DeviceInfo | null = null;

  get connected(): boolean {
    return !!this.device;
  }

  private onInput = (e: HIDInputReportEvent): void => {
    this.inbox.push({ id: e.reportId, data: new Uint8Array(e.data.buffer) });
    this.drain();
  };

  /** Hand each buffered report to a matching waiter (matches by report id). */
  private drain(): void {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const wi = this.waiters.findIndex((w) => w.id === this.inbox[i]!.id);
      if (wi >= 0) {
        const w = this.waiters.splice(wi, 1)[0]!;
        clearTimeout(w.timer);
        w.resolve(this.inbox.splice(i, 1)[0]!.data);
      }
    }
  }

  async open(filters: HidFilter[]): Promise<DeviceInfo> {
    // requestDevice must run inside a user gesture (the UI calls attachHid on click).
    const chosen = await navigator.hid.requestDevice({
      filters: filters.map((f) => ({
        ...(f.vendorId !== undefined ? { vendorId: f.vendorId } : {}),
        ...(f.productId !== undefined ? { productId: f.productId } : {}),
        ...(f.usagePage !== undefined ? { usagePage: f.usagePage } : {}),
      })),
    });
    const dev = chosen[0];
    if (!dev) throw new Error("no HID device selected");
    if (!dev.opened) await dev.open();
    dev.addEventListener("inputreport", this.onInput);
    this.device = dev;
    this.info = { vendorId: dev.vendorId, productId: dev.productId, product: dev.productName };
    return this.info;
  }

  async close(): Promise<void> {
    if (this.device) {
      this.device.removeEventListener("inputreport", this.onInput);
      try { await this.device.close(); } catch { /* already gone */ }
    }
    this.device = null;
    this.inbox = [];
    for (const w of this.waiters.splice(0)) clearTimeout(w.timer);
  }

  async sendReport(reportId: number, data: Uint8Array): Promise<void> {
    if (!this.device) throw new Error("HID device not open");
    // Uint8Array<ArrayBufferLike> vs BufferSource (TS 5.x generic buffer) — safe here.
    await this.device.sendReport(reportId, data as unknown as BufferSource);
  }

  readReport(reportId: number, timeoutMs: number): Promise<Uint8Array> {
    const idx = this.inbox.findIndex((r) => r.id === reportId);
    if (idx >= 0) return Promise.resolve(this.inbox.splice(idx, 1)[0]!.data);
    return new Promise<Uint8Array>((resolve, reject) => {
      const w = {
        id: reportId,
        resolve,
        timer: setTimeout(() => {
          const k = this.waiters.indexOf(w);
          if (k >= 0) this.waiters.splice(k, 1);
          reject(new Error("timeout waiting for HID report " + reportId));
        }, timeoutMs),
      };
      this.waiters.push(w);
    });
  }
}
