# OpenPolycom Provisioning Wizard

The wizard that unlocks Polycom conference-room hardware and installs
[open firmware](https://github.com/Polycom-Open-Firmware/poly-firmware-build)
on it — live at **[wizard.openpolycom.cc](https://wizard.openpolycom.cc/)**.
Everything runs in the browser: plug the device into USB, open the page in
Chrome or Edge, and click through. Nothing to install, no drivers, no
command line.

What it can do:

- **Unlock** a device and land the open stage-2 bootloader
- **Install or reinstall** the OS (A/B Android slot images over fastboot)
- **Configure** devices with no shell — hostname, kiosk page, passwords,
  time zone, certificates
  ([the contract](https://github.com/Polycom-Open-Firmware/poly-firmware-build/blob/main/CONFIG-PARTITION.md))
- **Update the bootloader** in the field, with no serial cable

Supported devices:

| Device | First-time unlock | How the browser reaches it |
|---|---|---|
| **Polycom TC8** touch panel | one-time UART hookup, driven by the browser over Web Serial | WebUSB fastboot + Web Serial |
| **Polycom Trio C60** | all-browser (BOOT_MODE switches → SDP) | WebHID SDP → WebUSB fastboot |

## One codebase, two flavors

- **Web** — the default, zero-install flavor above. For devices the browser
  can reach: WinUSB-bound fastboot (TC8) and a WebHID-reachable BootROM (C60).
- **Native (Tauri)** — for hosts and devices the browser can't reach:
  Windows machines that won't bind a driver, or protocols with no web API.
  Scaffolded, with a pure-Rust SDP loader standing in for WebHID (the Tauri
  webview has none).

[`ARCHITECTURE.md`](./ARCHITECTURE.md) explains the design — the transport
seam that lets both flavors share ~95% of the code.

## Layout

```
packages/
  core/      transport-agnostic engine — protocols, flows, device profiles.
             Never imports a platform USB binding. The bulk of the app.
  web/       web flavor adapter: WebUSB / Web Serial / WebHID / HTTP artifacts.
  native/    Tauri app (Rust nusb + serialport backend, pure-Rust SDP loader).
functions/   Cloudflare Pages Function — same-origin firmware-artifact proxy.
```

## Develop

```
npm install
npm run typecheck                    # all workspaces
npm run dev -w @provisioner/web      # wizard dev server (http://localhost:5173)
npm run build -w @provisioner/web    # production bundle
```

The web app needs Chrome or Edge and a secure context (localhost counts).
Firmware artifacts come from the GitHub releases of
[poly-firmware-build](https://github.com/Polycom-Open-Firmware/poly-firmware-build):
in production through the same-origin proxy, in local dev from
`packages/web/public/artifacts/`. Deploys are automatic — pushing `main`
rebuilds wizard.openpolycom.cc (see [`CLOUDFLARE.md`](./CLOUDFLARE.md)).

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the layered design: transport seam, protocols, flows, device profiles
- [`CLOUDFLARE.md`](./CLOUDFLARE.md) — hosting the web flavor: the artifact proxy, cost, and limits
- [`C60.md`](./C60.md) — the C60 SDP unlock: WebHID in the browser, pure-Rust native fallback
- Firmware side: [poly-firmware-build](https://github.com/Polycom-Open-Firmware/poly-firmware-build) — image build, boot model ([FLASHING](https://github.com/Polycom-Open-Firmware/poly-firmware-build/blob/main/FLASHING.md)), config contract ([CONFIG-PARTITION](https://github.com/Polycom-Open-Firmware/poly-firmware-build/blob/main/CONFIG-PARTITION.md))

## Status

v0.4.1, live at [wizard.openpolycom.cc](https://wizard.openpolycom.cc/).

- **TC8** — unlock, reinstall, and configure proven on hardware.
- **C60** — browser unlock (WebHID SDP) boots our U-Boot on hardware; the
  install tail is the same fastboot flow as the TC8. Persistent autoboot is
  still a firmware-side TODO.
- **Native (Tauri)** — wired (`uuu` shell-out by default, pure-Rust SDP
  behind `native_sdp`), not yet exercised on hardware.
