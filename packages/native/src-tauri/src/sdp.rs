// SPDX-License-Identifier: GPL-2.0-or-later

//! Pure-Rust i.MX Serial Download Protocol (SDP) loader over USB HID (`nusb`) —
//! the native replacement for shelling to `uuu`, so no per-OS binary needs
//! bundling. Reimplements what `uuu -b spl flash.bin` does for i.MX8MM (the C60):
//!
//!   Stage 1 (BootROM SDP, 1fc9:0134): parse the IVT at the head of flash.bin,
//!     WRITE_FILE the SPL image to its self-address, then JUMP to it. The SPL
//!     runs, brings up DDR, and re-enumerates as an SDPV device.
//!   Stage 2 (SPL "SDPV"): WRITE_FILE the rest of flash.bin (skipping the SPL —
//!     `-skipspl`) into DRAM, then JUMP. U-Boot (ATF+u-boot FIT) runs.
//!
//! Constants/structs transcribed verbatim from mfgtools `libuuu/sdp.{h,cpp}`.
//!
//! STATUS: protocol codec + IVT parsing are unit-tested below. The USB HID I/O
//! and the two-stage orchestration are implemented but UNVALIDATED on hardware
//! (no C60 in SDP mode on the bench). Items flagged HW-VERIFY need a real device.

use std::time::Duration;

use nusb::MaybeFuture;

// ---- protocol constants (libuuu/sdp.h) ----------------------------------------

pub const SDP_VID: u16 = 0x1fc9;
pub const SDP_PID_BOOTROM: u16 = 0x0134; // i.MX8MM BootROM in SDP mode
// The SPL's SDPV re-enumeration PID — CONFIRMED on a real C60 via the WebHID PoC:
// the SPL "USB download gadget" is 1fc9:0151 (distinct from the final U-Boot
// fastboot gadget at 1fc9:0152).
pub const SDP_PID_SPL_SDPV: u16 = 0x0151;

const CMD_RD_MEM: u16 = 0x0101;
#[allow(dead_code)]
const CMD_WR_MEM: u16 = 0x0202;
const CMD_WR_FILE: u16 = 0x0404;
#[allow(dead_code)]
const CMD_ERROR_STATUS: u16 = 0x0505;
#[allow(dead_code)]
const CMD_DCD_WRITE: u16 = 0x0A0A;
const CMD_JUMP_ADDR: u16 = 0x0B0B;

const ROM_WRITE_ACK: u32 = 0x128A_8A12;
const ROM_STATUS_ACK: u32 = 0x8888_8888;
#[allow(dead_code)]
const ROM_OK_ACK: u32 = 0x900D_D009;

const IVT_BARKER_HEADER: u32 = 0x4020_00D1;
const IVT_BARKER2_HEADER: u32 = 0x4120_00D1;

// HID report IDs (host->device: 1=command, 2=data; device->host: 3=HAB, 4=status).
const REPORT_CMD: u8 = 1;
const REPORT_DATA: u8 = 2;
const REPORT_HAB: u8 = 3;
const REPORT_STATUS: u8 = 4;
// SDP HID data report payload is 1024 bytes (report id + 1024).
const DATA_CHUNK: usize = 1024;

// ---- SDP command packet (libuuu/sdp.h, #pragma pack(1), 16 bytes) -------------

struct SdpCmd {
    cmd: u16,
    addr: u32,
    format: u8,
    count: u32,
    data: u32,
    rsvd: u8,
}

impl SdpCmd {
    /// Serialize to the 16-byte on-wire packet. Multi-byte fields are big-endian
    /// (uuu's `EndianSwap`). Field order matches the packed C struct exactly.
    fn encode(&self) -> [u8; 16] {
        let mut b = [0u8; 16];
        b[0..2].copy_from_slice(&self.cmd.to_be_bytes());
        b[2..6].copy_from_slice(&self.addr.to_be_bytes());
        b[6] = self.format;
        b[7..11].copy_from_slice(&self.count.to_be_bytes());
        b[11..15].copy_from_slice(&self.data.to_be_bytes());
        b[15] = self.rsvd;
        b
    }
}

// ---- flash.bin IVT / BootData parsing (libuuu/sdp.cpp) ------------------------

#[derive(Debug, Clone, Copy)]
pub struct Ivt {
    pub file_off: usize,
    pub entry: u32,       // ImageStartAddr
    pub dcd_addr: u32,    // DCDAddress
    pub boot_data: u32,   // pointer (addr space) to BootData
    pub self_addr: u32,   // SelfAddr — where this IVT loads
}

#[derive(Debug, Clone, Copy)]
pub struct BootData {
    pub image_start_addr: u32,
    pub image_size: u32,
    pub plugin_flag: u32,
}

fn rd_u32(buf: &[u8], off: usize) -> Option<u32> {
    buf.get(off..off + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// Scan for the IVT barker (0x402000D1 / 0x412000D1) within `limit` bytes from
/// `from`, on 4-byte alignment (matches uuu's `search_ivt_header`).
pub fn find_ivt(buf: &[u8], from: usize, limit: usize) -> Option<Ivt> {
    let end = (from + limit).min(buf.len());
    let mut off = from;
    while off + 32 <= end {
        if let Some(barker) = rd_u32(buf, off) {
            if barker == IVT_BARKER_HEADER || barker == IVT_BARKER2_HEADER {
                return Some(Ivt {
                    file_off: off,
                    entry: rd_u32(buf, off + 4)?,
                    dcd_addr: rd_u32(buf, off + 12)?,
                    boot_data: rd_u32(buf, off + 16)?,
                    self_addr: rd_u32(buf, off + 20)?,
                });
            }
        }
        off += 4;
    }
    None
}

/// Read the BootData the IVT points at. `boot_data` is an address in the loaded
/// image's address space; its file offset = ivt.file_off + (boot_data - self_addr).
pub fn read_boot_data(buf: &[u8], ivt: &Ivt) -> Option<BootData> {
    let foff = ivt.file_off as i64 + (ivt.boot_data as i64 - ivt.self_addr as i64);
    if foff < 0 {
        return None;
    }
    let foff = foff as usize;
    Some(BootData {
        image_start_addr: rd_u32(buf, foff)?,
        image_size: rd_u32(buf, foff + 4)?,
        plugin_flag: rd_u32(buf, foff + 8)?,
    })
}

/// The byte length of the SPL image described by `ivt`/`bd`, i.e. where `-skipspl`
/// resumes: `ImageSize - (SelfAddr - ImageStartAddr)` (libuuu SDPWriteCmd).
pub fn spl_image_len(ivt: &Ivt, bd: &BootData) -> usize {
    (bd.image_size as usize).saturating_sub((ivt.self_addr - bd.image_start_addr) as usize)
}

// ---- HID transport (nusb) -----------------------------------------------------

/// One SDP HID device (BootROM or SPL/SDPV). Reports go out on the interrupt OUT
/// endpoint if present, else via a SET_REPORT control transfer; replies come in on
/// interrupt IN. HW-VERIFY: endpoint discovery + control fallback on real silicon.
pub struct HidSdp {
    iface: nusb::Interface,
    ep_out: Option<nusb::Endpoint<nusb::transfer::Interrupt, nusb::transfer::Out>>,
    ep_in: nusb::Endpoint<nusb::transfer::Interrupt, nusb::transfer::In>,
}

impl HidSdp {
    // NOTE: open()/report I/O intentionally live here so the pure codec above stays
    // testable without USB. Implemented against nusb 0.2; HW-VERIFY the report
    // framing (control SET_REPORT vs interrupt OUT) against a device.
    fn write_report(&mut self, report_id: u8, payload: &[u8]) -> Result<(), String> {
        use nusb::transfer::{Buffer, ControlOut, ControlType, Recipient};
        let mut buf = Vec::with_capacity(payload.len() + 1);
        buf.push(report_id);
        buf.extend_from_slice(payload);
        if let Some(ep) = self.ep_out.as_mut() {
            ep.submit(Buffer::from(buf));
            ep.wait_next_complete(Duration::from_secs(5))
                .ok_or("hid report OUT timed out")?
                .status
                .map_err(|e| format!("hid OUT: {e:?}"))?;
            Ok(())
        } else {
            // SET_REPORT (bmRequestType 0x21, bRequest 0x09), wValue = (0x02<<8)|id.
            self.iface
                .control_out(
                    ControlOut {
                        control_type: ControlType::Class,
                        recipient: Recipient::Interface,
                        request: 0x09,
                        value: ((0x02u16) << 8) | report_id as u16,
                        index: 0,
                        data: &buf,
                    },
                    Duration::from_secs(5),
                )
                .wait()
                .map_err(|e| format!("SET_REPORT: {e:?}"))
        }
    }

    fn read_report(&mut self, want_id: u8, timeout: Duration) -> Result<Vec<u8>, String> {
        use nusb::transfer::Buffer;
        self.ep_in.submit(Buffer::new(65));
        let comp = self
            .ep_in
            .wait_next_complete(timeout)
            .ok_or("hid report IN timed out")?;
        comp.status.map_err(|e| format!("hid IN: {e:?}"))?;
        let v = comp.buffer.into_vec();
        if v.first().copied() != Some(want_id) {
            return Err(format!("unexpected report id {:?} (wanted {want_id})", v.first()));
        }
        Ok(v[1..].to_vec())
    }

    fn command(&mut self, c: &SdpCmd) -> Result<(), String> {
        self.write_report(REPORT_CMD, &c.encode())
    }

    fn send_data(&mut self, data: &[u8]) -> Result<(), String> {
        for chunk in data.chunks(DATA_CHUNK) {
            self.write_report(REPORT_DATA, chunk)?;
        }
        Ok(())
    }

    fn read_ack_u32(&mut self) -> Result<u32, String> {
        let s = self.read_report(REPORT_STATUS, Duration::from_secs(10))?;
        let b: [u8; 4] = s.get(0..4).ok_or("short status report")?.try_into().unwrap();
        Ok(u32::from_le_bytes(b))
    }

    /// WRITE_FILE `data` to `addr`, then verify the ROM ACKs.
    fn write_file(&mut self, addr: u32, data: &[u8]) -> Result<(), String> {
        self.command(&SdpCmd {
            cmd: CMD_WR_FILE,
            addr,
            format: 0,
            count: data.len() as u32,
            data: 0,
            rsvd: 0,
        })?;
        // Device replies with a HAB report first (report 3), then we stream data.
        let _hab = self.read_report(REPORT_HAB, Duration::from_secs(5))?;
        self.send_data(data)?;
        let ack = self.read_ack_u32()?;
        if ack != ROM_WRITE_ACK && ack != ROM_STATUS_ACK {
            return Err(format!("WRITE_FILE not acked (got {ack:#010x})"));
        }
        Ok(())
    }

    /// JUMP to `addr` (the device then executes; no normal status follows).
    fn jump(&mut self, addr: u32) -> Result<(), String> {
        self.command(&SdpCmd {
            cmd: CMD_JUMP_ADDR,
            addr,
            format: 0,
            count: 0,
            data: 0,
            rsvd: 0,
        })?;
        let _hab = self.read_report(REPORT_HAB, Duration::from_secs(5)).ok();
        Ok(())
    }
}

// ---- device open + two-stage orchestration ------------------------------------

impl HidSdp {
    /// Open an SDP HID device by VID/PID and claim its interrupt endpoints. Mirrors
    /// lib.rs `usb_open`, but selects Interrupt (HID) endpoints. HW-VERIFY on silicon.
    pub fn open(vid: u16, pid: u16) -> Result<Self, String> {
        use nusb::descriptors::TransferType;
        use nusb::transfer::{Direction, In, Interrupt, Out};

        let di = nusb::list_devices()
            .wait()
            .map_err(|e| e.to_string())?
            .find(|d| d.vendor_id() == vid && d.product_id() == pid)
            .ok_or_else(|| format!("no SDP device {vid:04x}:{pid:04x} found"))?;
        let dev = di.open().wait().map_err(|e| format!("open: {e}"))?;
        let config = dev.active_configuration().map_err(|e| format!("config: {e}"))?;

        let mut chosen: Option<(u8, u8, Option<u8>)> = None; // iface, in_addr, out_addr?
        for id in config.interface_alt_settings() {
            let (mut ep_in, mut ep_out) = (None, None);
            for ep in id.endpoints() {
                if ep.transfer_type() == TransferType::Interrupt {
                    match ep.direction() {
                        Direction::In => ep_in = Some(ep.address()),
                        Direction::Out => ep_out = Some(ep.address()),
                    }
                }
            }
            if let Some(i) = ep_in {
                chosen = Some((id.interface_number(), i, ep_out));
                break;
            }
        }
        let (iface_num, in_addr, out_addr) =
            chosen.ok_or("no interrupt IN endpoint on the SDP HID interface")?;
        let iface = dev
            .claim_interface(iface_num)
            .wait()
            .map_err(|e| format!("claim interface {iface_num}: {e}"))?;
        let ep_in = iface
            .endpoint::<Interrupt, In>(in_addr)
            .map_err(|e| format!("IN endpoint: {e}"))?;
        let ep_out = match out_addr {
            Some(a) => Some(
                iface
                    .endpoint::<Interrupt, Out>(a)
                    .map_err(|e| format!("OUT endpoint: {e}"))?,
            ),
            None => None,
        };
        Ok(Self { iface, ep_out, ep_in })
    }

    /// Stage 1 (BootROM SDP): load the SPL from the head of flash.bin and jump.
    pub fn boot_spl(&mut self, flash: &[u8], log: &mut dyn FnMut(&str)) -> Result<(), String> {
        let ivt = find_ivt(flash, 0, 0x100000).ok_or("no IVT at head of flash.bin")?;
        let bd = read_boot_data(flash, &ivt).ok_or("no BootData for the SPL")?;
        let len = spl_image_len(&ivt, &bd);
        let img = flash
            .get(ivt.file_off..ivt.file_off + len)
            .ok_or("SPL image range out of bounds")?;
        log(&format!("SDP: writing SPL ({} B) to {:#010x}", img.len(), ivt.self_addr));
        self.write_file(ivt.self_addr, img)?;
        log(&format!("SDP: jump {:#010x}", ivt.self_addr));
        self.jump(ivt.self_addr)
    }

    /// Stage 2 (SPL "SDPV"): load the rest of flash.bin (the U-Boot FIT container,
    /// which carries its own IVT) into DRAM and jump.
    pub fn boot_uboot(&mut self, flash: &[u8], log: &mut dyn FnMut(&str)) -> Result<(), String> {
        let spl = find_ivt(flash, 0, 0x100000).ok_or("no SPL IVT")?;
        let bd = read_boot_data(flash, &spl).ok_or("no SPL BootData")?;
        let rest = spl.file_off + spl_image_len(&spl, &bd);
        let ivt = find_ivt(flash, rest, 0x100000).ok_or("no U-Boot IVT after the SPL")?;
        let bd2 = read_boot_data(flash, &ivt).ok_or("no U-Boot BootData")?;
        let img = flash
            .get(ivt.file_off..ivt.file_off + bd2.image_size as usize)
            .ok_or("U-Boot image range out of bounds")?;
        log(&format!("SDPV: writing U-Boot ({} B) to {:#010x}", img.len(), ivt.self_addr));
        self.write_file(ivt.self_addr, img)?;
        log(&format!("SDPV: jump {:#010x}", ivt.self_addr));
        self.jump(ivt.self_addr)
    }
}

/// Full native load: BootROM (SPL) → wait for the SPL to re-enumerate (SDPV) →
/// SDPV (U-Boot). The `uuu`-free path. UNVALIDATED on hardware — the SDPV PID and
/// the report framing are the items to confirm against a real C60.
pub fn load_uboot(flash: &[u8], log: &mut dyn FnMut(&str)) -> Result<(), String> {
    log("SDP: opening the BootROM device (1fc9:0134)…");
    let mut rom = HidSdp::open(SDP_VID, SDP_PID_BOOTROM)?;
    rom.boot_spl(flash, log)?;
    drop(rom);

    log("waiting for the SPL to re-enumerate (SDPV)…");
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let up = nusb::list_devices()
            .wait()
            .map_err(|e| e.to_string())?
            .any(|d| d.vendor_id() == SDP_VID && d.product_id() == SDP_PID_SPL_SDPV);
        if up {
            break;
        }
        if std::time::Instant::now() > deadline {
            return Err("SPL did not re-enumerate as SDPV in time (HW-VERIFY the SDPV PID)".into());
        }
        std::thread::sleep(Duration::from_millis(300));
    }

    let mut spl = HidSdp::open(SDP_VID, SDP_PID_SPL_SDPV)?;
    spl.boot_uboot(flash, log)?;
    log("native SDP load complete — U-Boot should be running.");
    Ok(())
}

#[allow(dead_code)]
const _READ_MEM_OPCODE: u16 = CMD_RD_MEM; // reserved for a future read-back probe

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmd_encodes_big_endian_in_struct_order() {
        let c = SdpCmd { cmd: CMD_WR_FILE, addr: 0x0091_2000, format: 0, count: 0x1234, data: 0, rsvd: 0 };
        let b = c.encode();
        assert_eq!(&b[0..2], &[0x04, 0x04]); // cmd BE
        assert_eq!(&b[2..6], &[0x00, 0x91, 0x20, 0x00]); // addr BE
        assert_eq!(b[6], 0); // format
        assert_eq!(&b[7..11], &[0x00, 0x00, 0x12, 0x34]); // count BE
        assert_eq!(b.len(), 16);
    }

    #[test]
    fn jump_cmd_code() {
        let c = SdpCmd { cmd: CMD_JUMP_ADDR, addr: 0x4020_0000, format: 0, count: 0, data: 0, rsvd: 0 };
        assert_eq!(&c.encode()[0..2], &[0x0b, 0x0b]);
    }

    #[test]
    fn finds_ivt_and_reads_boot_data() {
        // Synthetic flash.bin: IVT at 0, self=0x912000, boot_data ptr = self+0x20,
        // BootData at file off 0x20 → {start=0x912000, size=0x4000, plugin=0}.
        let mut buf = vec![0u8; 0x100];
        buf[0..4].copy_from_slice(&IVT_BARKER_HEADER.to_le_bytes());
        buf[4..8].copy_from_slice(&0x0091_2000u32.to_le_bytes()); // entry
        buf[16..20].copy_from_slice(&0x0091_2020u32.to_le_bytes()); // boot_data ptr
        buf[20..24].copy_from_slice(&0x0091_2000u32.to_le_bytes()); // self_addr
        buf[0x20..0x24].copy_from_slice(&0x0091_2000u32.to_le_bytes()); // bd.start
        buf[0x24..0x28].copy_from_slice(&0x0000_4000u32.to_le_bytes()); // bd.size
        let ivt = find_ivt(&buf, 0, 0x1000).expect("ivt");
        assert_eq!(ivt.self_addr, 0x0091_2000);
        assert_eq!(ivt.entry, 0x0091_2000);
        let bd = read_boot_data(&buf, &ivt).expect("bootdata");
        assert_eq!(bd.image_size, 0x4000);
        // self==start here, so skip length == image size.
        assert_eq!(spl_image_len(&ivt, &bd), 0x4000);
    }

    #[test]
    fn skipspl_accounts_for_self_above_start() {
        let ivt = Ivt { file_off: 0, entry: 0x912400, dcd_addr: 0, boot_data: 0x912020, self_addr: 0x912400 };
        let bd = BootData { image_start_addr: 0x912000, image_size: 0x5000, plugin_flag: 0 };
        // 0x5000 - (0x912400 - 0x912000) = 0x5000 - 0x400 = 0x4c00
        assert_eq!(spl_image_len(&ivt, &bd), 0x4c00);
    }
}
