// backend.ts — the native Backend factory + a Tauri runtime probe. The same SPA
// bundle ships in both flavors; at startup it picks this backend when running
// inside the Tauri webview, otherwise the web (WebUSB) backend.
import type { Backend, SerialTransport, UsbTransport } from "@provisioner/core";
import { NativeUsbTransport } from "./usb";
import { NativeSerialTransport } from "./serial";

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
