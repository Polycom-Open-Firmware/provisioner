// SPDX-License-Identifier: GPL-2.0-or-later

// usb.ts — native (Tauri) implementation of core's UsbTransport. The web half
// uses WebUSB; this half forwards every call to the Rust backend over Tauri IPC
// (nusb under the hood), so the same fastboot protocol code runs unchanged.
import { invoke } from "@tauri-apps/api/core";
import type {
  ControlSetup,
  DeviceInfo,
  InterfaceMatch,
  UsbFilter,
  UsbTransport,
} from "@provisioner/core";

export class NativeUsbTransport implements UsbTransport {
  private dev: DeviceInfo | null = null;

  get info(): DeviceInfo | null {
    return this.dev;
  }
  get connected(): boolean {
    return this.dev !== null;
  }

  async open(
    filters: UsbFilter[],
    iface?: InterfaceMatch,
    opts?: { serial?: string },
  ): Promise<DeviceInfo> {
    // The Rust side opens the device the picker chose (by serial), or the first
    // matching a filter; then claims the interface and finds its bulk endpoints.
    const info = await invoke<DeviceInfo>("usb_open", {
      filters,
      iface: iface ?? null,
      serial: opts?.serial ?? null,
    });
    this.dev = info;
    return info;
  }

  async close(): Promise<void> {
    await invoke("usb_close");
    this.dev = null;
  }

  async bulkOut(data: Uint8Array): Promise<void> {
    await invoke("usb_bulk_out", { data: Array.from(data) });
  }

  async bulkIn(length: number): Promise<Uint8Array> {
    const out = await invoke<number[]>("usb_bulk_in", { length });
    return new Uint8Array(out);
  }

  async controlOut(setup: ControlSetup, data?: Uint8Array): Promise<void> {
    await invoke("usb_control_out", { setup, data: data ? Array.from(data) : [] });
  }

  async controlIn(setup: ControlSetup, length: number): Promise<Uint8Array> {
    const out = await invoke<number[]>("usb_control_in", { setup, length });
    return new Uint8Array(out);
  }
}
