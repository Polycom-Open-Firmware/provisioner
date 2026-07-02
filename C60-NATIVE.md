# C60 native unlock (UUU / SDP) — implementation notes

Status: **wired end-to-end; compiles (TS typecheck + `cargo check`); UNTESTED on
hardware** (no C60 in SDP mode on the bench yet). Started 2026-07-02.

The Polycom Trio C60 (codename `kepler_proto1`, i.MX 8M Mini) can't be unlocked
from a browser: its BootROM recovery is i.MX **SDP** (`1fc9:0134`), driven by
**`uuu`**, which ships no WinUSB/WebUSB descriptors. So the C60 Unlock flow is
`nativeOnly` and the work happens in the native (Tauri) backend.

## What was wired

Layered the same way as everything else — the flow is generic, only the backend
is native:

- **`core/transport.ts`** — new optional `Backend.c60Provision(opts)` capability
  (`flashBin`, `hammerSecs`, `cmds`, `uartPath?`, `onLog`). Web backend leaves it
  undefined; native implements it.
- **`core/profiles/c60.ts`** — `c60UnlockFlow` now runs the real procedure
  (intro → "enter recovery" confirm → `uuu-boot` action → done). The action fetches
  the recipe from the artifact manifest and calls `ctx.backend.c60Provision`.
- **`web/src/native/backend.ts`** — `c60Provision` invokes the `c60_provision`
  Tauri command and forwards `c60-progress` events to `onLog`.
- **`native/src-tauri/src/lib.rs`** — `c60_provision` command: stage `flash.bin` →
  wait for SDP `1fc9:0134` (nusb) → `uuu -b spl flash.bin` (spawned, like the
  handoff's backgrounded `uuu … &`) → open UART (`serialport`) → hammer CR for
  `hammerSecs` → send the slot `cmds` → kill uuu. Streams `c60-progress` events.

This mirrors the proven handoff in `polycom-uboot/scripts/c60-dualboot/`
(`c60-boot` + `c60_boot_seq.py`) and `targets/c60-kepler_proto1/BOOT_RECIPES.md`.

## Design choice: shell to `uuu` (don't reimplement SDP)

`uuu -b spl` runs a multi-stage SDP/mfgtool protocol (load SPL via SDP, jump, then
load ATF+U-Boot). Reimplementing that in Rust would be a large, error-prone effort;
`uuu` is proven. The native backend shells to it. The UART driving (the part that's
simple and specific to our recipe) is native Rust via `serialport`.

## Prerequisites to actually run it

1. **`uuu` on PATH / bundled.** Present on the dev host (`~/.local/bin/uuu`). For
   releases it must be bundled — add per-platform `uuu` to `tauri.conf.json`
   `bundle.externalBin` and resolve its path in `c60_provision` (currently calls
   bare `uuu`). Windows/macOS builds need their own `uuu` binaries. **TODO.**
2. **`c60-manifest.json` artifact** served alongside the others, shape:
   ```json
   {
     "flashbin": { "url": "c60/flash.bin" },
     "hammerSecs": 14,
     "bootSeq": {
       "a": [
         "mmc dev 0",
         "mmc read 0x44000000 0x8000 0x18000",
         "cp.b 0x44000800 0x40080000 0x019f4a00",
         "cp.b 0x459f5800 0x46000000 0xb79d",
         "setenv bootargs 'console=tty0 console=ttymxc1,115200 … root=/dev/disk/by-partlabel/system_a'",
         "booti 0x40080000 - 0x46000000"
       ]
     }
   }
   ```
   The `mmc read`/`cp.b` addresses are **build-specific** (depend on packed kernel
   size) — regenerate with each image build. That's exactly why they live in the
   manifest, not the code. `flash.bin` = `scripts/build.sh c60-kepler_proto1` output.

## Known limitations (next phase — see BOOT_RECIPES.md TODOs)

- **DRAM boot, not persistent.** This boots a *pre-flashed* slot A each time from
  the host. Autonomous autoboot needs a `bootcmd` macro persisted to env
  (`bootcmd_kerbek` / a `boot_slot` selector) — deferred in the handoff.
- **In-app image flashing** isn't done. Slot images are flashed once via the U-Boot
  fastboot gadget separately. Wiring `fastboot` over the uuu-loaded U-Boot into the
  flow is future work (handoff notes mfgtool-path gadget init issues).
- Not run on hardware yet: verify SDP detection, uuu invocation, and the UART recipe
  against a real C60 before shipping.
