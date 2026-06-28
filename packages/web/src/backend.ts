// backend.ts — the web Backend factory. A UI shell calls webBackend() and hands
// it (plus an Artifacts source) to a WizardRunner; everything above is shared.
import type { Backend, UsbTransport, SerialTransport } from "@provisioner/core";
import { WebUsbTransport } from "./usb";
import { WebSerialTransport } from "./serial";

export class WebBackend implements Backend {
  readonly kind = "web" as const;

  usb(): UsbTransport {
    return new WebUsbTransport();
  }

  serial(): SerialTransport {
    return new WebSerialTransport();
  }
  // No bindWinUsb on web — the device must already present a WinUSB binding
  // (MS-OS descriptors). That capability is the native flavor's reason to exist.
}

export function webBackend(): Backend {
  return new WebBackend();
}

/** Feature probe for the UI to gate on (Chromium + secure context). */
export function webSupport(): { usb: boolean; serial: boolean; secure: boolean } {
  return {
    usb: typeof navigator !== "undefined" && "usb" in navigator,
    serial: typeof navigator !== "undefined" && "serial" in navigator,
    secure: typeof window !== "undefined" && window.isSecureContext,
  };
}
