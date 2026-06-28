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
- ⏳ React + shadcn UI (separate thread — wizard markup from Claude designer).
- ⏳ Native (Tauri) flavor.

## Develop

```
npm install
npm run typecheck   # all workspaces
```
