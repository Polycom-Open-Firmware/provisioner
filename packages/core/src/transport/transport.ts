// transport.ts — the seam. This is the ONLY contract that differs between the
// web flavor (WebUSB / Web Serial) and the native flavor (Tauri invoke() → Rust
// nusb / serialport). Everything above this line (protocols, flows, profiles,
// UI) is written once against these interfaces and shared by both flavors.
//
// Design rule: no file under core/ may import `navigator.usb`, `@tauri-apps/api`,
// or any platform USB binding. They take a Transport; the shell injects one.

/** A description of a connectable device, surfaced to the chooser/UI. */
export interface DeviceInfo {
  vendorId: number;
  productId: number;
  product?: string;
  manufacturer?: string;
  serial?: string;
}

/** Filter passed to the adapter's device picker (web: requestDevice). */
export interface UsbFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
}

/**
 * How the adapter should locate the interface + bulk endpoints to claim once a
 * device is open. The fastboot gadget is class 0xff / sub 0x42 / proto 0x03 with
 * two bulk endpoints; DFU/other protocols pass a different match later.
 */
export interface InterfaceMatch {
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
}

export interface ControlSetup {
  requestType: "standard" | "class" | "vendor";
  recipient: "device" | "interface" | "endpoint" | "other";
  request: number;
  value: number;
  index: number;
}

/**
 * Bulk USB transport — fastboot, DFU-over-bulk, etc. ride on this. The adapter
 * owns device selection, opening, interface/endpoint discovery and claiming; the
 * protocol layer above only ever calls bulkOut/bulkIn (and control* for DFU/SDP).
 */
export interface UsbTransport {
  readonly info: DeviceInfo | null;
  readonly connected: boolean;

  /** Select + open a matching device, claim its interface, find bulk endpoints. */
  open(filters: UsbFilter[], iface?: InterfaceMatch): Promise<DeviceInfo>;
  close(): Promise<void>;

  /** Bulk OUT a chunk to the claimed interface's OUT endpoint. */
  bulkOut(data: Uint8Array): Promise<void>;
  /** Bulk IN up to `length` bytes from the IN endpoint. */
  bulkIn(length: number): Promise<Uint8Array>;

  /** Control transfers — DFU and SDP need these; fastboot does not. */
  controlOut(setup: ControlSetup, data?: Uint8Array): Promise<void>;
  controlIn(setup: ControlSetup, length: number): Promise<Uint8Array>;
}

/** Console-style serial transport — drives the U-Boot prompt during bootstrap. */
export interface SerialTransport {
  readonly connected: boolean;
  open(opts?: { baudRate?: number }): Promise<void>;
  /** Send a line; the adapter appends the carriage return U-Boot expects. */
  send(line: string): Promise<void>;
  writeRaw(bytes: Uint8Array): Promise<void>;
  /** Discard buffered input up to now, so the next readUntil only sees fresh data. */
  drain(): void;
  /** Resolve when `needle` is seen after the cursor; advance past it. */
  readUntil(needle: string, timeoutMs?: number): Promise<string>;
  /** Native-only signal control (optional; web omits it). */
  setSignals?(s: { dtr?: boolean; rts?: boolean; brk?: boolean }): Promise<void>;
  close(): Promise<void>;
}

/**
 * The backend a UI shell injects. The web shell builds these from `navigator.*`;
 * the native shell builds them from Tauri `invoke()` calls. Flows/protocols
 * depend on this factory, never on a concrete implementation.
 */
export interface Backend {
  readonly kind: "web" | "native";
  usb(): UsbTransport;
  serial(): SerialTransport;
  /** Native-only: bind WinUSB to a device so it can be opened at all (libwdi). */
  bindWinUsb?(info: DeviceInfo): Promise<void>;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
