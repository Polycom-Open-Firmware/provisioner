# Provisioner — Architecture

Status: **built and shipping** — the web flavor is live at
[wizard.openpolycom.cc](https://wizard.openpolycom.cc/), the native (Tauri)
flavor is scaffolded. Written 2026-06-28 as the design plan; updated
2026-07-03 to match what shipped.

The provisioning **wizard, as a standalone application**. Two flavors from one
codebase: a zero-install **web** flavor and a **native (Tauri)** flavor for
devices that the browser cannot reach.

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
| **Windows driver binding** — raw USB needs WinUSB/libusbK bound to the device. | Cannot install a driver. Dead in the water for any device that doesn't ship MS-OS descriptors. | Bundles a `libwdi`/Zadig-style install → binds WinUSB to any device automatically. This is the main reason native exists. |
| **DFU mode** (USB DFU class, control-transfer protocol) | Works only if the DFU interface is WinUSB-bound (webdfu proves the protocol is doable). Binding is the wall. | `nusb` + DFU control transfers, driver auto-bound. Universal. |
| **i.MX SDP / BootROM recovery** (HID vendor protocol) | Turned out to work: the C60 BootROM's vendor HID is reachable over WebHID ([C60.md](./C60.md)). Other devices' HID usages may still be blocked. | Pure-Rust SDP loader — reliable everywhere, including the Tauri webview (which has no WebHID). |
| **No fastboot at all** — UMS-only, raw block, vendor protocols, JTAG/SWD | Mostly unreachable. | Whatever the device speaks. |
| **Serial signal control** — toggling DTR/RTS or sending BREAK to drop a SoC into its bootloader | Web Serial lacks full signal control on some platforms. | `serialport` crate — full control. |
| **Offline or air-gapped factory, batch flashing, local firmware library, logs, auto-update** | Localhost-HTTPS ceremony, one device at a time, network fetch. | Single signed binary, on-disk image library, multi-unit. |

Rule of thumb: web for cooperative devices (zero friction), native for stubborn
devices (DFU-only, no-fastboot, or any Windows host that won't bind). Same
wizard, same UI, two transports.

---

## 2. The keystone: a layered seam

The whole design rests on never letting the wizard touch `navigator.usb`
directly. The original pathfinder tool did exactly that (its `fastboot.js`
called `this.device.transferOut(...)`, its `serial.js` called
`navigator.serial`); refactoring that coupling out was the core of the port.

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
  interface. The pathfinder's `Fastboot` class was ported to take an injected
  transport instead of `this.device`; SDP arrived later as a new protocol
  module, the same way.
- **Flow + Profile** is the wizard logic: an ordered, resumable list of steps
  (identify → preserve identity → flash → verify → reboot), each step a protocol
  op plus an artifact. A **device profile** picks which protocols and steps
  apply. This is what lets one app provision many devices instead of being
  TC8-hardcoded — the C60 dropped in as a second profile with no refactor.
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
      src/ui/             shared wizard components (React + shadcn/ui)
    web/                  WebUSB / Web Serial / WebHID adapters + static host
    native/               Tauri app
      src-tauri/          Rust backend: nusb, serialport; sdp.rs (pure-Rust SDP)
  functions/              Cloudflare Pages Function — firmware-artifact proxy
  ARCHITECTURE.md
  README.md
```

One repo, one source of truth. `core` has no platform imports. `web` and `native`
are thin shells that supply a transport adapter and host the UI.

---

## 4. Native stack (Tauri v2)

- **Tauri v2** webview loads the built core UI bundle (the same one the web flavor
  ships). The frontend calls Tauri `invoke()` for USB instead of `navigator.usb`.
- **Rust USB:** `nusb` — pure Rust, no libusb C build dependency, clean
  cross-compile (Windows, macOS, Linux). (`rusb`/libusb is the fallback if a
  protocol needs something `nusb` lacks.)
- **Serial:** `serialport` crate (full DTR/RTS/BREAK control).
- **SDP:** `sdp.rs`, a pure-Rust SDP loader over `nusb` — the Tauri webview has
  no WebHID, so the native flavor drives the BootROM itself ([C60.md](./C60.md)).
- **Windows driver bind:** `libwdi` (auto-install WinUSB) — the load-bearing
  native capability, still to be phased in: ship first with "device must
  already be bound", add auto-bind when a non-cooperative device needs it.
- **Progress streaming:** Tauri events (Rust → webview) for byte-level flash
  progress, mirroring the web flavor's `onProgress` callbacks.

---

## 5. The port from the pathfinder tool

The original single-purpose WebUSB tool was proven on hardware (Debian boots
end-to-end), so it was ported, not rewritten:

- `fastboot.js` → `core/src/protocol/fastboot.ts`, transport injected.
- `serial.js`  → `core/src/protocol/uboot-console.ts`, over a SerialTransport.
- `sparse.js`  → `core/src/protocol/sparse.ts` (already pure logic — easiest).
- `enroll.js` / `flashos.js` → `core/src/flow/unlock.ts` / `reinstall-linux.ts`
  step machines.
- `manifest.js` + `artifacts/` → profile-scoped artifact manifests.
- The old static HTML pages → the wizard UI.

The web adapter is essentially the `navigator.usb`/`navigator.serial` glue
lifted out of the original classes.

---

## 6. Decisions (resolved)

1. **UI stack** — **React + shadcn/ui** (+ Tailwind), decided 2026-06-28. Plain
   React components render identically in the browser and the Tauri webview, so
   `core/` ships shared components and logic, and both flavors mount the same
   tree.
2. **Scope of abstraction** — baked in from day one, and validated when the
   second device arrived: the C60 landed as a new profile plus one new protocol
   module (SDP), no refactor.
3. **libwdi timing** — deferred. WebHID turned out to reach the C60's BootROM,
   so the browser covers it; the native flavor ships "device must already be
   bound" until a non-cooperative device forces auto-bind.
4. **Distribution** — web: Cloudflare Pages at
   [wizard.openpolycom.cc](https://wizard.openpolycom.cc/), auto-deployed on
   push ([CLOUDFLARE.md](./CLOUDFLARE.md)). Native: unsigned dev builds first;
   code-signing and auto-update later.
