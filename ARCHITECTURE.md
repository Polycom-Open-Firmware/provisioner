# Provisioner — Architecture

Status: **PLANNING** · Owner: alex · Started 2026-06-28
The provisioning **wizard, as a standalone application**. Two flavors from one
codebase: a zero-install **web** flavor and a **native (Tauri)** flavor for
devices that the browser physically cannot reach.

This is the app, not the project landing page. The landing page
(`polycom-open-firmware.github.io`) links to / hosts the web flavor but is a
separate deliverable. Device-side firmware decisions live in
`tc8-dev/PROVISIONING_SPEC.md`; this doc owns the host application.

---

## 1. Why two flavors

The web flavor is the default: open a URL in Chrome, plug in, flash. No install,
no driver ceremony — **for devices that cooperate with the browser** (i.e. that
present a WinUSB binding on Windows, like TC8 fastboot does today).

The native flavor exists for the "this MUST be an app" devices — the cases where
a browser is physically incapable, not just inconvenient:

| Blocker | Browser | Native (Tauri + Rust) |
|---|---|---|
| **Windows driver binding** — raw USB needs WinUSB/libusbK bound to the device. | Cannot install a driver. Dead in the water for any device that doesn't ship MS-OS descriptors. | Bundles `libwdi`/Zadig-style install → binds WinUSB to **any** device automatically. **This is the #1 reason native exists.** |
| **DFU mode** (USB DFU class, control-transfer protocol) | Works *only* if the DFU iface is WinUSB-bound (webdfu proves the protocol is doable). Binding is the wall. | `nusb` + `dfu` control transfers, driver auto-bound. Universal. |
| **i.MX SDP / BootROM recovery** (HID-ish vendor protocol) | WebHID is restricted/blocked for many vendor usages. | `hidapi` / raw control — reliable. |
| **No fastboot at all** — UMS-only, raw block, vendor protocols, JTAG/SWD | Mostly unreachable. | Whatever the device speaks. |
| **Serial signal control** — toggling DTR/RTS / sending BREAK to drop a SoC into its bootloader | Web Serial lacks full signal control on some platforms. | `serialport` crate — full control. |
| **Offline / air-gapped factory, batch flashing, local firmware library, logs, auto-update** | Localhost-HTTPS ceremony, one device at a time, network fetch. | Single signed binary, on-disk image library, multi-unit. |

**Rule of thumb:** web for cooperative devices (zero friction), native for stubborn
devices (DFU-only, SDP-only, no-fastboot, or any Windows host that won't bind).
Same wizard, same UI, two transports.

---

## 2. The keystone: a layered seam

The whole design rests on **never letting the wizard touch `navigator.usb`
directly.** Today's `provision-tool` code does exactly that (`fastboot.js` calls
`this.device.transferOut(...)`, `serial.js` calls `navigator.serial`). Refactoring
that coupling out is the core work of this thread.

Four layers, each depending only on the one below via an interface:

```
┌──────────────────────────────────────────────────────────┐
│  UI / Wizard            renders a Profile's steps, generic │  ← built by the UI thread
├──────────────────────────────────────────────────────────┤
│  Flow + Profile         resumable step machine per device  │  enroll, flash-OS, ...
│                         "TC8 = fastboot+serial bootstrap"  │  tc8.ts, <future>.ts
├──────────────────────────────────────────────────────────┤
│  Protocol               what the bytes mean                │  fastboot, dfu, sdp,
│                         (injected a Transport, not a USB)   │  uboot-console, ums
├──────────────────────────────────────────────────────────┤
│  Transport              how bytes move                      │  ← the swap point
│   UsbTransport / SerialTransport / HidTransport (interfaces)│
└──────────────────────────────────────────────────────────┘
         web adapter  →  WebUSB / Web Serial / WebHID
         native adapter → Tauri invoke() → Rust nusb / serialport / hidapi
```

- **Transport** is the *only* layer that differs between web and native. It's a
  thin interface: open/claim, `bulkOut(bytes)`, `bulkIn(len)`, `controlTransfer`,
  list/describe. The web adapter wraps `navigator.usb`; the native adapter wraps
  `invoke("usb_bulk_out", ...)` over Tauri IPC to a Rust backend.
- **Protocol** (fastboot, DFU, …) is written *once* against the Transport
  interface. Port the existing `Fastboot` class to take an injected transport
  instead of `this.device`. DFU/SDP are new protocol modules added the same way.
- **Flow + Profile** is the wizard logic: an ordered, resumable list of steps
  (identify → preserve identity → flash → verify → reboot), each step a protocol
  op + an artifact. A **device profile** picks which protocols/steps apply. This
  is what lets one app provision many devices instead of being TC8-hardcoded.
- **UI** renders a profile's steps generically and streams progress. It is
  injected a backend; it never imports a transport.

Because only the Transport layer is swapped, **web and native share ~95% of the
code** — all protocol, flow, profile, and UI logic is identical.

---

## 3. Repo layout (monorepo)

```
provisioner/
  packages/
    core/                 shared, transport-agnostic — the bulk of the app
      src/transport/      Transport interfaces (the seam contract)
      src/protocol/       fastboot.ts (port), dfu.ts, sdp.ts, uboot-console.ts
      src/flow/           enroll.ts, flash-os.ts  (resumable step machines)
      src/profiles/       tc8.ts  (and future devices)
      src/ui/             wizard components (stack TBD — see §6)
    web/                  WebUSB/WebSerial/WebHID adapters + static host
    native/               Tauri app
      src-tauri/          Rust backend: nusb, serialport, hidapi, libwdi
      (frontend = the same core UI bundle)
  ARCHITECTURE.md
  README.md
```

One repo, one source of truth. `core` has no platform imports. `web` and `native`
are thin shells that supply a transport adapter and host the UI.

---

## 4. Native stack (Tauri v2)

- **Tauri v2** webview loads the built core UI bundle (the same one the web flavor
  ships). The frontend calls Tauri `invoke()` for USB instead of `navigator.usb`.
- **Rust USB:** `nusb` — pure-Rust, no libusb C build dependency, clean
  cross-compile (Win/macOS/Linux). (`rusb`/libusb is the fallback if a protocol
  needs something `nusb` lacks.)
- **Serial:** `serialport` crate (full DTR/RTS/BREAK control).
- **HID (SDP):** `hidapi`.
- **Windows driver bind:** `libwdi` (auto-install WinUSB) — the load-bearing
  native capability. Phase it in: ship first with "device must already be bound,"
  add auto-bind when a non-cooperative device actually needs it.
- **Progress streaming:** Tauri events (Rust → webview) for byte-level flash
  progress, mirroring the web flavor's `onProgress` callbacks.

---

## 5. Migration from today's `provision-tool/`

The existing code is proven on hardware (Debian boots end-to-end) — we **port, not
rewrite**:
- `fastboot.js` → `core/src/protocol/fastboot.ts`, transport injected.
- `serial.js`  → `core/src/protocol/uboot-console.ts`, over a SerialTransport.
- `sparse.js`  → `core/src/protocol/sparse.ts` (already pure logic — easiest).
- `enroll.js` / `flashos.js` → `core/src/flow/*` step machines.
- `manifest.js` + `artifacts/` → profile-scoped artifact manifests.
- `index/enroll/flashos.html` → folded into the wizard UI.
The web adapter is essentially the `navigator.usb`/`navigator.serial` glue lifted
out of the current classes.

---

## 6. Open decisions (this thread)

1. **UI stack** — DECIDED (2026-06-28): **React + shadcn/ui** (+ Tailwind). Plain
   React components render identically in the browser and the Tauri webview, so
   `core/` ships shared components + logic and both flavors mount the same tree.
2. **Scope of abstraction now** — bake the Protocol/Profile abstraction in from
   day one (so DFU/SDP devices drop in later with no refactor), or port TC8
   straight and generalize when the second device actually arrives.
3. **libwdi timing** — auto driver-bind in the native MVP, or defer until a
   non-cooperative device forces it.
4. **Distribution** — web: static host (landing page / HTTPS). native: unsigned
   dev builds first; code-signing + auto-update later.
