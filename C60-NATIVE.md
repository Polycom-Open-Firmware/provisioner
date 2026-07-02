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

## Two U-Boot-load paths (`native_sdp` flag on `c60_provision`)

`uuu -b spl flash.bin` on i.MX8MM runs a two-stage load: BootROM **SDP**
(`1fc9:0134`) loads the SPL and jumps; the SPL brings up DDR and re-enumerates as
**SDPV**, which loads the U-Boot FIT into DRAM and jumps.

- **default (`native_sdp` off): shell to `uuu`.** Proven; needs `uuu` on PATH or
  bundled per-OS (the bundling pain). Kept as the fallback.
- **`native_sdp` on: pure-Rust SDP loader (`sdp.rs`) — no external binary.** This
  is the target: one Rust source compiles to all three OSes over `nusb`, no
  bundling, no macOS notarization of a bundled exe. It reimplements the SDP wire
  protocol (constants/structs transcribed verbatim from mfgtools `libuuu/sdp.{h,cpp}`):
  the 16-byte big-endian `SDPCmd`, `WRITE_FILE`/`JUMP`, HID reports 1–4, IVT/BootData
  parsing, and the `-skipspl` offset. **The protocol codec + IVT parsing are
  unit-tested (`cargo test --lib sdp::`, 4 tests green).**

The UART driving (recipe-specific, simple) is native Rust via `serialport` in both paths.

### `native_sdp` — what still needs a real C60 to confirm (HW-VERIFY)

The USB I/O can't be validated without hardware. Before flipping `native_sdp` on
by default:
- **SDPV re-enumeration PID** (`SDP_PID_SPL_SDPV`, currently `0x0152`) — confirm the
  SPL's download-gadget PID on a real C60.
- **HID report framing** — interrupt-OUT vs `SET_REPORT` control fallback; report
  sizes; the HAB (report 3) / status (report 4) handshake ordering around
  `WRITE_FILE`.
- **Stage-2 addressing** — that the U-Boot FIT's own IVT (after the SPL) carries the
  right `self_addr` (~`0x40200000` per BOOT_RECIPES memory map).

Until then, `uuu` (default) is how you test the flow on the bench.

## Prerequisites to actually run it

1. **U-Boot loader.** Either `uuu` on PATH/bundled (default path — present on the
   dev host at `~/.local/bin/uuu`; a shipped app would need per-OS `uuu` via
   `tauri.conf.json` `bundle.externalBin`), **or** — the goal — validate the
   pure-Rust `native_sdp` path so no binary is bundled at all (see below).
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
