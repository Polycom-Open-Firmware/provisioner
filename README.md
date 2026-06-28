# Provisioner

The device-provisioning **wizard, as an app** — one codebase, two flavors:

- **Web** — zero-install, runs in Chrome/Edge over WebUSB + Web Serial. For
  devices that cooperate with the browser (WinUSB-bound fastboot, like TC8).
- **Native (Tauri)** — for devices a browser physically can't reach: DFU-only,
  SDP-only, no-fastboot, or any Windows host that won't bind a driver. (Planned.)

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design.

## Layout

```
packages/
  core/    transport-agnostic engine — protocols, flows, device profiles.
           NEVER imports a platform USB binding. The bulk of the app.
  web/     web flavor adapter: WebUSB / Web Serial / HTTP artifacts.
  native/  Tauri app (Rust nusb/serialport backend). Planned.
```

The **seam** is `core/src/transport/transport.ts`: web and native each supply a
`Backend` implementing those interfaces; everything above is shared. Ported from
the proven pathfinder tool in `../provision-tool/`.

## Status

- ✅ Core engine: fastboot, sparse, U-Boot console; wizard runner + event stream;
  `unlock` and `reinstall-linux` flows; TC8 profile. Typechecks clean.
- ✅ Web transport adapter (WebUSB + Web Serial + HTTP artifacts).
- ✅ React + shadcn wizard UI wired to the runner — window / step rail / content /
  footer / persistent console, Polycom design tokens. Typechecks + builds clean.
- ⏳ Real device bring-up (needs hardware) + drop-in design assets.
- ⏳ Native (Tauri) flavor.

## Develop

```
npm install
npm run typecheck            # all workspaces
npm run dev -w @provisioner/web      # wizard dev server (http://localhost:5173)
npm run build -w @provisioner/web    # production bundle
```

The web app talks to the device over WebUSB + Web Serial, so it needs Chrome/Edge
and a secure context (localhost counts). Firmware artifacts are fetched from
`packages/web/public/artifacts/` (a manifest + images, supplied separately).
