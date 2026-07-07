// SPDX-License-Identifier: GPL-2.0-or-later

// types.ts — the wizard's data model. Shaped to match the Polycom Wizard design
// (see "Conversation & Design Notes.md"): a device exposes named flows; each flow
// is an ordered list of steps of four kinds — info / confirm / action / done. The
// UI renders these generically (rail + content + footer) and subscribes to the
// engine's event stream; it never imports a transport or a protocol.
import type { Backend, HidFilter, UsbFilter } from "../transport/transport";
import type { Fastboot } from "../protocol/fastboot";
import type { UBootConsole } from "../protocol/uboot-console";
import type { Sdp } from "../protocol/sdp";

export type StepType = "info" | "confirm" | "action" | "done";

/** A physical action the operator must take before a confirm step proceeds. */
export type Gesture = "connect-serial" | "connect-usb" | "connect-hid" | "power-cycle" | null;

interface StepBase {
  id: string;
  /** Short mono label shown in the step rail. */
  rail: string;
  /** Tier-1 rail group label. Consecutive steps sharing a `group` render in the
   *  rail as indented sub-steps under one header. Presentation-only: the runner's
   *  flat index, next/back, and the footer's step count are unaffected. */
  group?: string;
  /** Heading in the content region. */
  title: string;
  /** Body copy (plain/markdown); the UI renders it. */
  body?: string;
  /** Ordered image URLs to show as a step-through slideshow (e.g. disassembly). */
  gallery?: string[];
  /** Single illustration for this step. On gesture steps it REPLACES the built-in
   *  device-generic connect hint (so devices don't inherit another device's photo). */
  image?: string;
}

export interface InfoStep extends StepBase {
  type: "info";
}

export interface ConfirmStep extends StepBase {
  type: "confirm";
  /** Custom primary-button label (design notes: confirm steps set their own). */
  confirmLabel?: string;
  /** Gesture the operator performs before the button enables, if any. */
  gesture?: Gesture;
  /** For a `connect-hid` gesture: which HID device to request (each SDP stage
   *  targets a different one — BootROM then the SPL gadget). */
  hidFilters?: HidFilter[];
}

/** Confirmation gate for a destructive action. The UI shell must show a blocking
 *  modal (Confirm/Cancel over a dimmed backdrop) BEFORE performing the step's
 *  gesture/run. Data only — the dialog component lives in the UI package. Only
 *  honored on gesture actions (every destructive step today is one). */
export interface DangerGate {
  title: string;
  message: string;
  /** Confirm-button label (default "Continue"). */
  confirmLabel?: string;
}

export interface ActionStep extends StepBase {
  type: "action";
  /** Streams to the console; drives the progress bar. Auto-runs on entry UNLESS
   *  `gesture` is set, in which case it waits for its start button (which performs
   *  the device pick, then runs — merging the old connect-step + action pair). */
  run: (ctx: FlowContext) => Promise<void>;
  /** If set, the UI interposes a blocking confirm modal before the start button's
   *  device pick / run. For irreversible operations (wiping userdata, replacing
   *  the installed OS). */
  danger?: DangerGate;
  /** If set, don't auto-run: show a start button that does this gesture (the device
   *  pick, which must originate from a user click) and then runs. */
  gesture?: Gesture;
  /** Start-button label for a gesture action (e.g. "Connect & flash"). */
  confirmLabel?: string;
  /** HID device filters for a `connect-hid` gesture action. */
  hidFilters?: HidFilter[];
}

export interface DoneStep extends StepBase {
  type: "done";
}

export type Step = InfoStep | ConfirmStep | ActionStep | DoneStep;

export interface Flow {
  id: string;
  title: string;
  /** One-line summary for the "what do you want to do?" picker. */
  summary?: string;
  /** Marks a not-yet-implemented flow as the "Soon" placeholder. */
  soon?: boolean;
  /**
   * This flow can only run in the native (Tauri) flavor — its transport has no
   * browser equivalent (e.g. i.MX SDP / UUU BootROM recovery, which ships no
   * WebUSB descriptors). The web flavor renders it disabled with a "Native app
   * required" note and refuses to start it.
   */
  nativeOnly?: boolean;
  steps: Step[];
}

export interface Device {
  id: string;
  name: string;
  /** Browser USB filters that identify this device in fastboot mode. */
  filters?: UsbFilter[];
  flows: Flow[];
}

/** Resolves profile artifacts (firmware images, manifests) per platform. */
export interface Artifacts {
  /** Parsed JSON manifest at `name` (e.g. "os-manifest.json"). */
  manifest(name: string): Promise<any>;
  /** Binary artifact bytes. `ref` is a manifest-relative url or a logical name. */
  binary(ref: string): Promise<Uint8Array>;
}

/**
 * Passed to every action step. Gives it the connected protocol handles, the
 * artifact source, progress/log emitters, and the user-gesture connect helpers
 * (USB/serial selection MUST originate from a real click — the UI wires these).
 */
export interface FlowContext {
  backend: Backend;
  artifacts: Artifacts;
  /** Lazily-connected fastboot handle (connectUsb resolves it). */
  fb: Fastboot;
  /** Lazily-connected U-Boot serial console (connectSerial resolves it). */
  uboot: UBootConsole;
  /** Lazily-connected i.MX SDP handle over HID (connectHid resolves it). */
  sdp: Sdp;
  /** Append a line to the persistent console pane (engine adds the timestamp). */
  log: (msg: string) => void;
  /** Drive the action step's progress bar (0..total). */
  progress: (done: number, total: number) => void;
  /** Resolve once the operator has picked + opened the USB device (gesture). */
  connectUsb: () => Promise<void>;
  /** Resolve once the operator has picked + opened the serial port (gesture). */
  connectSerial: (baudRate?: number) => Promise<void>;
  /** Resolve once the operator has picked + opened the HID (SDP) device (gesture). */
  connectHid: () => Promise<void>;
}
