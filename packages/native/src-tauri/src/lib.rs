// SPDX-License-Identifier: GPL-2.0-or-later

//! Native (Tauri) backend for the Open Polycom provisioner.
//!
//! Implements core's `UsbTransport` / `SerialTransport` contracts (see
//! `packages/web/src/native/*.ts`) over real hardware: USB via `nusb`, serial via
//! `serialport`. The same wizard + fastboot/U-Boot protocol code runs in the Tauri
//! webview and calls these commands instead of WebUSB / Web Serial.
//!
//! USB uses single transfers per call (one packet in / one packet out) to preserve
//! fastboot's packet framing, matching WebUSB's transferIn/transferOut semantics.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nusb::descriptors::TransferType;
use nusb::transfer::{Buffer, Bulk, Direction, In, Out};
use nusb::{Endpoint, MaybeFuture};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

// ---- shared types (camelCase across the IPC boundary, matching core) ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsbFilter {
    vendor_id: Option<u16>,
    product_id: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InterfaceMatch {
    class_code: Option<u8>,
    subclass_code: Option<u8>,
    protocol_code: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceInfo {
    vendor_id: u16,
    product_id: u16,
    product: Option<String>,
    manufacturer: Option<String>,
    serial: Option<String>,
}

// ---- USB (nusb) ---------------------------------------------------------------

struct UsbInner {
    _interface: nusb::Interface,
    ep_in: Endpoint<Bulk, In>,
    ep_out: Endpoint<Bulk, Out>,
    ep_in_mps: usize,
}

#[derive(Default)]
struct UsbState(Mutex<Option<UsbInner>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsbDeviceDesc {
    vendor_id: u16,
    product_id: u16,
    product: Option<String>,
    manufacturer: Option<String>,
    serial: Option<String>,
}

#[tauri::command]
fn usb_list(filters: Vec<UsbFilter>) -> Result<Vec<UsbDeviceDesc>, String> {
    let all = nusb::list_devices().wait().map_err(|e| e.to_string())?;
    Ok(all
        .filter(|d| {
            filters.is_empty()
                || filters.iter().any(|f| {
                    f.vendor_id.map_or(true, |v| v == d.vendor_id())
                        && f.product_id.map_or(true, |p| p == d.product_id())
                })
        })
        .map(|d| UsbDeviceDesc {
            vendor_id: d.vendor_id(),
            product_id: d.product_id(),
            product: d.product_string().map(str::to_string),
            manufacturer: d.manufacturer_string().map(str::to_string),
            serial: d.serial_number().map(str::to_string),
        })
        .collect())
}

#[tauri::command]
fn usb_open(
    filters: Vec<UsbFilter>,
    iface: Option<InterfaceMatch>,
    serial: Option<String>,
    state: State<UsbState>,
) -> Result<DeviceInfo, String> {
    // Default match is the fastboot signature (class 0xff / sub 0x42 / proto 0x03).
    let want = iface.unwrap_or(InterfaceMatch {
        class_code: Some(0xff),
        subclass_code: Some(0x42),
        protocol_code: Some(0x03),
    });

    // No chooser on native — pick the first device matching a VID/PID filter.
    let di = nusb::list_devices()
        .wait()
        .map_err(|e| e.to_string())?
        .find(|d| match serial.as_deref() {
            // A specific device was chosen in the picker -> match its serial.
            Some(s) if !s.is_empty() => d.serial_number() == Some(s),
            _ => filters.iter().any(|f| {
                f.vendor_id.map_or(true, |v| v == d.vendor_id())
                    && f.product_id.map_or(true, |p| p == d.product_id())
            }),
        })
        .ok_or("no matching USB device found (is it plugged in and in fastboot?)")?;

    let info = DeviceInfo {
        vendor_id: di.vendor_id(),
        product_id: di.product_id(),
        product: di.product_string().map(str::to_string),
        manufacturer: di.manufacturer_string().map(str::to_string),
        serial: di.serial_number().map(str::to_string),
    };

    let device = di.open().wait().map_err(|e| format!("open failed: {e}"))?;
    let config = device
        .active_configuration()
        .map_err(|e| format!("config read failed: {e}"))?;

    // Find the matching interface + its two bulk endpoint addresses.
    let mut chosen: Option<(u8, u8, u8)> = None;
    for id in config.interface_alt_settings() {
        let ok = want.class_code.map_or(true, |c| id.class() == c)
            && want.subclass_code.map_or(true, |c| id.subclass() == c)
            && want.protocol_code.map_or(true, |c| id.protocol() == c);
        if !ok {
            continue;
        }
        let (mut ep_in, mut ep_out) = (0u8, 0u8);
        for ep in id.endpoints() {
            if ep.transfer_type() == TransferType::Bulk {
                match ep.direction() {
                    Direction::In => ep_in = ep.address(),
                    Direction::Out => ep_out = ep.address(),
                }
            }
        }
        if ep_in != 0 && ep_out != 0 {
            chosen = Some((id.interface_number(), ep_in, ep_out));
            break;
        }
    }
    let (iface_num, ep_in_addr, ep_out_addr) =
        chosen.ok_or("no matching interface with bulk IN/OUT endpoints")?;

    let interface = device
        .claim_interface(iface_num)
        .wait()
        .map_err(|e| format!("claim interface {iface_num} failed: {e}"))?;
    let ep_out = interface
        .endpoint::<Bulk, Out>(ep_out_addr)
        .map_err(|e| format!("open OUT endpoint: {e}"))?;
    let ep_in = interface
        .endpoint::<Bulk, In>(ep_in_addr)
        .map_err(|e| format!("open IN endpoint: {e}"))?;
    let ep_in_mps = ep_in.max_packet_size().max(1);

    *state.0.lock().unwrap() = Some(UsbInner {
        _interface: interface,
        ep_in,
        ep_out,
        ep_in_mps,
    });
    Ok(info)
}

#[tauri::command]
fn usb_close(state: State<UsbState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
fn usb_bulk_out(data: Vec<u8>, state: State<UsbState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let u = guard.as_mut().ok_or("usb not open")?;
    u.ep_out.submit(Buffer::from(data));
    let comp = u
        .ep_out
        .wait_next_complete(Duration::from_secs(30))
        .ok_or("bulk_out timed out")?;
    comp.status.map_err(|e| format!("bulk_out: {e:?}"))?;
    Ok(())
}

#[tauri::command]
fn usb_bulk_in(length: usize, state: State<UsbState>) -> Result<Vec<u8>, String> {
    let mut guard = state.0.lock().unwrap();
    let u = guard.as_mut().ok_or("usb not open")?;
    // IN requested_len must be a nonzero multiple of max packet size; the device's
    // short response packet ends the transfer early.
    let req = length.max(1).div_ceil(u.ep_in_mps) * u.ep_in_mps;
    u.ep_in.submit(Buffer::new(req));
    let comp = u
        .ep_in
        .wait_next_complete(Duration::from_secs(15))
        .ok_or("bulk_in timed out")?;
    comp.status.map_err(|e| format!("bulk_in: {e:?}"))?;
    Ok(comp.buffer.into_vec())
}

// Control transfers aren't needed by fastboot (they're for future DFU/SDP).
#[tauri::command]
fn usb_control_out(_setup: serde_json::Value, _data: Vec<u8>) -> Result<(), String> {
    Err("control transfers are not implemented yet (not needed for fastboot)".into())
}
#[tauri::command]
fn usb_control_in(_setup: serde_json::Value, _length: usize) -> Result<Vec<u8>, String> {
    Err("control transfers are not implemented yet (not needed for fastboot)".into())
}

// ---- Serial (serialport) ------------------------------------------------------

struct SerialInner {
    port: Box<dyn serialport::SerialPort>,
    buf: Arc<Mutex<Vec<u8>>>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
struct SerialState(Mutex<Option<SerialInner>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortDesc {
    name: String,
    kind: String,
    product: Option<String>,
}

#[tauri::command]
fn serial_list() -> Result<Vec<PortDesc>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let (kind, product) = match &p.port_type {
                serialport::SerialPortType::UsbPort(u) => ("USB".to_string(), u.product.clone()),
                other => (format!("{other:?}"), None),
            };
            PortDesc {
                name: p.port_name,
                kind,
                product,
            }
        })
        .collect())
}

#[tauri::command]
fn serial_open(baud_rate: u32, path: Option<String>, state: State<SerialState>) -> Result<(), String> {
    // Use the explicitly-chosen port; otherwise prefer a USB serial adapter.
    let path = match path {
        Some(p) if !p.is_empty() => p,
        _ => {
            let ports = serialport::available_ports().map_err(|e| e.to_string())?;
            ports
                .iter()
                .find(|p| matches!(p.port_type, serialport::SerialPortType::UsbPort(_)))
                .or_else(|| ports.first())
                .map(|p| p.port_name.clone())
                .ok_or("no serial ports found")?
        }
    };

    let port = serialport::new(&path, baud_rate)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| {
            let lm = e.to_string().to_lowercase();
            if lm.contains("denied") || lm.contains("in use") || lm.contains("busy") || lm.contains("access") {
                format!("Port {path} is in use — close any program using it (PuTTY, a serial monitor, etc.) and try again.")
            } else {
                format!("Couldn't open {path}: {e}")
            }
        })?;

    // A reader thread buffers bytes; serial_read drains them (mirrors the web read
    // loop so core's readUntil works the same).
    let mut reader = port.try_clone().map_err(|e| e.to_string())?;
    let buf = Arc::new(Mutex::new(Vec::new()));
    let stop = Arc::new(AtomicBool::new(false));
    {
        let buf = buf.clone();
        let stop = stop.clone();
        std::thread::spawn(move || {
            let mut tmp = [0u8; 4096];
            while !stop.load(Ordering::Relaxed) {
                match reader.read(&mut tmp) {
                    Ok(0) => {}
                    Ok(n) => buf.lock().unwrap().extend_from_slice(&tmp[..n]),
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                    Err(_) => std::thread::sleep(Duration::from_millis(20)),
                }
            }
        });
    }

    *state.0.lock().unwrap() = Some(SerialInner { port, buf, stop });
    Ok(())
}

#[tauri::command]
fn serial_read(state: State<SerialState>) -> Result<Vec<u8>, String> {
    let guard = state.0.lock().unwrap();
    let s = guard.as_ref().ok_or("serial not open")?;
    let mut b = s.buf.lock().unwrap();
    Ok(std::mem::take(&mut *b))
}

#[tauri::command]
fn serial_write(data: Vec<u8>, state: State<SerialState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let s = guard.as_mut().ok_or("serial not open")?;
    s.port.write_all(&data).map_err(|e| e.to_string())?;
    s.port.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn serial_signals(
    dtr: Option<bool>,
    rts: Option<bool>,
    _brk: Option<bool>,
    state: State<SerialState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let s = guard.as_mut().ok_or("serial not open")?;
    if let Some(d) = dtr {
        s.port.write_data_terminal_ready(d).map_err(|e| e.to_string())?;
    }
    if let Some(r) = rts {
        s.port.write_request_to_send(r).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn serial_close(state: State<SerialState>) -> Result<(), String> {
    if let Some(s) = state.0.lock().unwrap().take() {
        s.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ---- C60 SDP / UUU boot -------------------------------------------------------
//
// No browser equivalent — the i.MX BootROM (SDP) speaks a vendor HID protocol with
// no WinUSB/WebUSB descriptors. We shell to the proven `uuu` tool for the SDP load
// (reimplementing SDP in Rust would be far riskier), then drive the U-Boot autoboot
// interrupt + slot boot sequence over UART. Mirrors polycom-uboot's
// scripts/c60-dualboot handoff. Progress streams to the webview as `c60-progress`.

#[derive(Clone, Serialize)]
struct C60Progress {
    line: String,
}

fn c60_emit(app: &AppHandle, line: impl Into<String>) {
    let _ = app.emit("c60-progress", C60Progress { line: line.into() });
}

const SDP_VID: u16 = 0x1fc9;
const SDP_PID: u16 = 0x0134;

#[tauri::command]
fn c60_provision(
    app: AppHandle,
    flash_bin: Vec<u8>,
    hammer_secs: u64,
    cmds: Vec<String>,
    uart_path: Option<String>,
) -> Result<(), String> {
    // 1. Stage flash.bin for uuu.
    let mut tmp = std::env::temp_dir();
    tmp.push("c60-flash.bin");
    std::fs::write(&tmp, &flash_bin).map_err(|e| format!("staging flash.bin: {e}"))?;
    c60_emit(&app, format!("staged U-Boot ({} bytes)", flash_bin.len()));

    // 2. Wait for the SDP device (both BOOT_MODE switches OFF -> 1fc9:0134).
    c60_emit(&app, "waiting for the device in recovery (SDP) mode (1fc9:0134)…");
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    loop {
        let found = nusb::list_devices()
            .wait()
            .map_err(|e| e.to_string())?
            .any(|d| d.vendor_id() == SDP_VID && d.product_id() == SDP_PID);
        if found {
            break;
        }
        if std::time::Instant::now() > deadline {
            return Err("timed out waiting for the device in SDP mode (1fc9:0134) — set both BOOT_MODE switches OFF and reconnect USB".into());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    c60_emit(&app, "device detected — loading the open bootloader via uuu…");

    // 3. Load our U-Boot over SDP. uuu keeps serving after the load (like the
    //    handoff's backgrounded `uuu … &`), so spawn it and move on after a beat
    //    rather than waiting for it to exit.
    let mut uuu = std::process::Command::new("uuu")
        .arg("-b")
        .arg("spl")
        .arg(&tmp)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start `uuu` (is it installed / bundled?): {e}"))?;
    std::thread::sleep(Duration::from_secs(3));
    c60_emit(&app, "bootloader loaded into RAM; opening the serial console…");

    // 4. Drive the U-Boot console over UART: hammer CR to catch the autoboot
    //    interrupt window, then send the slot boot sequence.
    let path = match uart_path {
        Some(p) if !p.is_empty() => p,
        _ => serialport::available_ports()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|p| matches!(p.port_type, serialport::SerialPortType::UsbPort(_)))
            .map(|p| p.port_name)
            .ok_or("no serial (UART) port found for the console")?,
    };
    let drive = (|| -> Result<(), String> {
        let mut port = serialport::new(&path, 115200)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| format!("open UART {path}: {e}"))?;
        c60_emit(&app, format!("interrupting autoboot over {path} (~{hammer_secs}s)…"));
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(hammer_secs) {
            let _ = port.write_all(b"\r");
            std::thread::sleep(Duration::from_millis(100));
        }
        std::thread::sleep(Duration::from_millis(500));
        for c in &cmds {
            c60_emit(&app, format!("> {c}"));
            port.write_all(c.as_bytes()).map_err(|e| e.to_string())?;
            port.write_all(b"\r").map_err(|e| e.to_string())?;
            // `mmc read` moves multi-MB and needs longer to complete.
            let wait = if c.starts_with("mmc read") { 2000 } else { 400 };
            std::thread::sleep(Duration::from_millis(wait));
        }
        Ok(())
    })();

    // uuu has done its job (U-Boot is in RAM); stop it regardless of the UART result.
    let _ = uuu.kill();
    drive?;
    c60_emit(&app, "boot sequence sent.");
    Ok(())
}

// ---- entry point --------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(UsbState::default())
        .manage(SerialState::default())
        .invoke_handler(tauri::generate_handler![
            usb_list,
            usb_open,
            usb_close,
            usb_bulk_out,
            usb_bulk_in,
            usb_control_out,
            usb_control_in,
            serial_list,
            serial_open,
            serial_read,
            serial_write,
            serial_signals,
            serial_close,
            c60_provision,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
