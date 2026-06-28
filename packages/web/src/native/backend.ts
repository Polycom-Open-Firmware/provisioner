// backend.ts — the native Backend factory + a Tauri runtime probe. The same SPA
// bundle ships in both flavors; at startup it picks this backend when running
// inside the Tauri webview, otherwise the web (WebUSB) backend.
import { invoke } from "@tauri-apps/api/core";
import type { Backend, SerialTransport, UsbFilter, UsbTransport } from "@provisioner/core";
import { NativeUsbTransport } from "./usb";
import { NativeSerialTransport } from "./serial";

/** A serial port the native backend can see (name + a human label). */
export interface SerialPortDesc {
  name: string;
  kind: string;
  product?: string;
}

/** List the host's serial ports (native only). */
export function listSerialPorts(): Promise<SerialPortDesc[]> {
  return invoke<SerialPortDesc[]>("serial_list");
}

/** A USB device the native backend can see. */
export interface UsbDeviceDesc {
  vendorId: number;
  productId: number;
  product?: string;
  manufacturer?: string;
  serial?: string;
}

/** List USB devices matching the given filters (native only). */
export function listUsbDevices(filters: UsbFilter[]): Promise<UsbDeviceDesc[]> {
  return invoke<UsbDeviceDesc[]>("usb_list", { filters });
}

/** True when running inside the Tauri webview (vs a plain browser). */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export class NativeBackend implements Backend {
  readonly kind = "native" as const;

  usb(): UsbTransport {
    return new NativeUsbTransport();
  }

  serial(): SerialTransport {
    return new NativeSerialTransport();
  }
}

export function nativeBackend(): Backend {
  return new NativeBackend();
}
