// SPDX-License-Identifier: GPL-2.0-or-later

// usb.ts — WebUSB implementation of core's UsbTransport. This is the web half of
// the seam: all the `navigator.usb` calls that used to live inside the pathfinder
// Fastboot class now live here, behind the interface, so core stays platform-free.
// The native flavor provides the same interface over Tauri → Rust nusb.
import type {
  ControlSetup,
  DeviceInfo,
  InterfaceMatch,
  UsbFilter,
  UsbTransport,
} from "@provisioner/core";

function infoOf(d: USBDevice): DeviceInfo {
  return {
    vendorId: d.vendorId,
    productId: d.productId,
    product: d.productName ?? undefined,
    manufacturer: d.manufacturerName ?? undefined,
    serial: d.serialNumber ?? undefined,
  };
}

export class WebUsbTransport implements UsbTransport {
  private device: USBDevice | null = null;
  private iface = 0;
  private epIn = 0;
  private epOut = 0;

  get info(): DeviceInfo | null {
    return this.device ? infoOf(this.device) : null;
  }

  get connected(): boolean {
    return !!this.device && this.device.opened;
  }

  async open(
    filters: UsbFilter[],
    iface?: InterfaceMatch,
    _opts?: { serial?: string }, // native-only; the browser always prompts
  ): Promise<DeviceInfo> {
    const dev = await navigator.usb.requestDevice({ filters: filters as USBDeviceFilter[] });
    await dev.open();
    if (dev.configuration === null) await dev.selectConfiguration(1);

    // Locate the interface to claim + its two bulk endpoints. Default match is
    // the fastboot signature (class 0xff / sub 0x42 / proto 0x03).
    const want: InterfaceMatch = iface ?? { classCode: 0xff, subclassCode: 0x42, protocolCode: 0x03 };
    let found: { ifaceNum: number; alt: USBAlternateInterface } | null = null;
    for (const cfg of dev.configurations) {
      for (const intf of cfg.interfaces) {
        const a = intf.alternate;
        const ok =
          (want.classCode === undefined || a.interfaceClass === want.classCode) &&
          (want.subclassCode === undefined || a.interfaceSubclass === want.subclassCode) &&
          (want.protocolCode === undefined || a.interfaceProtocol === want.protocolCode);
        if (ok) { found = { ifaceNum: intf.interfaceNumber, alt: a }; break; }
      }
      if (found) break;
    }
    if (!found) throw new Error("no matching USB interface found");

    this.iface = found.ifaceNum;
    for (const ep of found.alt.endpoints) {
      if (ep.type !== "bulk") continue;
      if (ep.direction === "in") this.epIn = ep.endpointNumber;
      else this.epOut = ep.endpointNumber;
    }
    if (!this.epIn || !this.epOut)
      throw new Error("interface missing bulk IN/OUT endpoints");

    await dev.claimInterface(this.iface);
    this.device = dev;
    return infoOf(dev);
  }

  async close(): Promise<void> {
    const d = this.device;
    if (!d) return;
    try { await d.releaseInterface(this.iface); } catch { /* already gone */ }
    try { await d.close(); } catch { /* already closed */ }
    this.device = null;
  }

  async bulkOut(data: Uint8Array): Promise<void> {
    if (!this.device) throw new Error("usb: not open");
    // Copy into a standalone ArrayBuffer — a subarray view can carry a byteOffset
    // that WebUSB rejects.
    await this.device.transferOut(this.epOut, data.slice());
  }

  async bulkIn(length: number): Promise<Uint8Array> {
    if (!this.device) throw new Error("usb: not open");
    const r = await this.device.transferIn(this.epIn, length);
    return r.data ? new Uint8Array(r.data.buffer) : new Uint8Array(0);
  }

  async controlOut(setup: ControlSetup, data?: Uint8Array): Promise<void> {
    if (!this.device) throw new Error("usb: not open");
    await this.device.controlTransferOut(
      { requestType: setup.requestType, recipient: setup.recipient, request: setup.request, value: setup.value, index: setup.index },
      data ? data.slice() : undefined,
    );
  }

  async controlIn(setup: ControlSetup, length: number): Promise<Uint8Array> {
    if (!this.device) throw new Error("usb: not open");
    const r = await this.device.controlTransferIn(
      { requestType: setup.requestType, recipient: setup.recipient, request: setup.request, value: setup.value, index: setup.index },
      length,
    );
    return r.data ? new Uint8Array(r.data.buffer) : new Uint8Array(0);
  }
}
