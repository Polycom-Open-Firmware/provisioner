# Provisioner — Architecture

The provisioning **wizard, as a standalone application**. Two flavors from one
codebase: a zero-install **web** flavor, live at
[wizard.openpolycom.cc](https://wizard.openpolycom.cc/), and a **native
(Tauri)** flavor for devices that the browser cannot reach.

This is the app, not the project landing page. Device-side firmware decisions
live in the
[firmware repo](https://github.com/Polycom-Open-Firmware/poly-firmware-build);
this doc owns the host application.

---

## 1. Why two flavors

The web flavor is the default: open a URL in Chrome, plug in, flash. No install,
no driver ceremony — for devices that cooperate with the browser (that is,
devices that present a WinUSB binding on Windows, like TC8 fastboot, or a
WebHID-reachable BootROM, like the C60).

The native flavor exists for the genuinely browser-proof cases — where a
browser is physically incapable, not just inconvenient:

| Blocker | Browser | Native (Tauri + Rust) |
|---|---|---|
| **Windows driver binding** — raw USB needs WinUSB/libusbK bound to the device. | Cannot install a driver. Dead in the water for any device that doesn't ship MS-OS descriptors. | Can bundle a `libwdi`/Zadig-style install → bind WinUSB to any device automatically. This is the main reason native exists. |
| **DFU mode** (USB DFU class, control-transfer protocol) | Works only if the DFU interface is WinUSB-bound (webdfu proves the protocol is doable). Binding is the wall. | `nusb` + DFU control transfers, driver auto-bound. Universal. |
| **i.MX SDP / BootROM recovery** (HID vendor protocol) | Works: the C60 BootROM's vendor HID is reachable over WebHID ([C60.md](./C60.md)). Other devices' HID usages may still be blocked. | Pure-Rust SDP loader — reliable everywhere, including the Tauri webview (which has no WebHID). |
| **No fastboot at all** — UMS-only, raw block, vendor protocols, JTAG/SWD | Mostly unreachable. | Whatever the device speaks. |
| **Serial signal control** — toggling DTR/RTS or sending BREAK to drop a SoC into its bootloader | Web Serial lacks full signal control on some platforms. | `serialport` crate — full control. |
| **Offline or air-gapped factory, batch flashing, local firmware library, logs, auto-update** | Localhost-HTTPS ceremony, one device at a time, network fetch. | Single signed binary, on-disk image library, multi-unit. |

Rule of thumb: web for cooperative devices (zero friction), native for stubborn
devices (DFU-only, no-fastboot, or any Windows host that won't bind). Same
wizard, same UI, two transports.

---

## 2. The keystone: a layered seam

The whole design rests on never letting the wizard touch `navigator.usb`
directly: protocol code takes a transport interface and never calls a
platform USB, serial, or HID API itself.

Four layers, each depending only on the one below through an interface:

```
┌──────────────────────────────────────────────────────────┐
│  UI / Wizard            renders a Profile's steps, generic │
├──────────────────────────────────────────────────────────┤
│  Flow + Profile         resumable step machine per device  │  unlock, reinstall, ...
│                         "TC8 = fastboot+serial bootstrap"  │  tc8.ts, c60.ts
├──────────────────────────────────────────────────────────┤
│  Protocol               what the bytes mean                │  fastboot, sdp,
│                         (injected a Transport, not a USB)   │  uboot-console, sparse
├──────────────────────────────────────────────────────────┤
│  Transport              how bytes move                      │  ← the swap point
│   UsbTransport / SerialTransport / HidTransport (interfaces)│
└──────────────────────────────────────────────────────────┘
         web adapter  →  WebUSB / Web Serial / WebHID
         native adapter → Tauri invoke() → Rust nusb / serialport
```

- **Transport** is the *only* layer that differs between web and native. It's a
  thin interface: open/claim, `bulkOut(bytes)`, `bulkIn(len)`, `controlTransfer`,
  list/describe. The web adapter wraps `navigator.usb`; the native adapter wraps
  `invoke("usb_bulk_out", ...)` over Tauri IPC to a Rust backend.
- **Protocol** (fastboot, SDP, …) is written once against the Transport
  interface, with the transport injected.
- **Flow + Profile** is the wizard logic: an ordered, resumable list of steps
  (identify → preserve identity → flash → verify → reboot), each step a protocol
  op plus an artifact. A **device profile** picks which protocols and steps
  apply. This is what lets one app provision many devices instead of being
  TC8-hardcoded — a new device is a new profile (plus any new protocol
  modules), with no changes to the rest of the app.
- **UI** renders a profile's steps generically and streams progress. It is
  injected a backend; it never imports a transport.

Because only the Transport layer is swapped, web and native share ~95% of the
code — all protocol, flow, profile, and UI logic is identical.

---

## 3. Repo layout (monorepo)

```
provisioner/
  packages/
    core/                 shared, transport-agnostic — the bulk of the app
      src/transport/      Transport interfaces (the seam contract)
      src/protocol/       fastboot.ts, sdp.ts, sparse.ts, uboot-console.ts
      src/flow/           unlock.ts, reinstall-linux.ts, configure.ts, partitions.ts
      src/profiles/       tc8.ts, c60.ts
    web/                  WebUSB / Web Serial / WebHID adapters + static host
      src/components/     wizard components (React + shadcn/ui)
    native/               Tauri app
      src-tauri/          Rust backend: nusb, serialport; sdp.rs (pure-Rust SDP)
  functions/              Cloudflare Pages Function — firmware-artifact proxy
  ARCHITECTURE.md
  README.md
```

One repo, one source of truth. `core` has no platform imports and no UI —
the React components live in `packages/web/src/components/`. `web` supplies
the web transport adapters and hosts the SPA; `native` is a desktop shell
that bundles the same SPA and supplies a Rust-backed transport adapter.

---

## 4. Native stack (Tauri v2)

- **Tauri v2** webview loads the built web SPA (the same bundle the web flavor
  ships). The frontend calls Tauri `invoke()` for USB instead of `navigator.usb`.
- **Rust USB:** `nusb` — pure Rust, no libusb C build dependency, clean
  cross-compile (Windows, macOS, Linux). (`rusb`/libusb is the fallback if a
  protocol needs something `nusb` lacks.)
- **Serial:** `serialport` crate (full DTR/RTS/BREAK control).
- **SDP:** the Tauri webview has no WebHID, so the native flavor drives the
  BootROM itself: `uuu` shell-out is the default; the pure-Rust SDP loader
  (`sdp.rs` over `nusb`) is available behind the `native_sdp` option
  ([C60.md](./C60.md)).
- **Windows driver bind:** the device must already be WinUSB-bound;
  `libwdi`-style auto-bind (auto-install WinUSB for any device) is the
  capability that would lift that requirement.
- **Progress streaming:** Tauri events (Rust → webview) for byte-level flash
  progress, mirroring the web flavor's `onProgress` callbacks.

---

## 5. Stack and distribution

- **UI stack** — **React + shadcn/ui** (+ Tailwind). Plain React components
  render identically in the browser and the Tauri webview, so one component
  tree in `packages/web/src/components/` serves both flavors.
- **Scope of abstraction** — `core` is platform-free; adding a device is a
  new profile plus any new protocol modules (the C60 is a profile plus the
  SDP module), no refactor.
- **Driver binding** — WebHID reaches the C60 BootROM's vendor HID
  interface, so the browser covers it; the native flavor requires the device
  to already be bound, and auto-bind becomes necessary only for a device
  Windows won't bind cooperatively.
- **Distribution** — web: Cloudflare Pages at
  [wizard.openpolycom.cc](https://wizard.openpolycom.cc/), deployed on push
  to `main` ([CLOUDFLARE.md](./CLOUDFLARE.md)). Native: unsigned dev builds;
  no code-signing, no auto-update.
