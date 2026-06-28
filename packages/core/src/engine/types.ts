// types.ts — the wizard's data model. Shaped to match the Polycom Wizard design
// (see "Conversation & Design Notes.md"): a device exposes named flows; each flow
// is an ordered list of steps of four kinds — info / confirm / action / done. The
// UI renders these generically (rail + content + footer) and subscribes to the
// engine's event stream; it never imports a transport or a protocol.
import type { Backend, UsbFilter } from "../transport/transport";
import type { Fastboot } from "../protocol/fastboot";
import type { UBootConsole } from "../protocol/uboot-console";

export type StepType = "info" | "confirm" | "action" | "done" | "form";

/** A physical action the operator must take before a confirm step proceeds. */
export type Gesture = "connect-serial" | "connect-usb" | "power-cycle" | null;

interface StepBase {
  id: string;
  /** Short mono label shown in the step rail. */
  rail: string;
  /** Heading in the content region. */
  title: string;
  /** Body copy (plain/markdown); the UI renders it. */
  body?: string;
  /** Ordered image URLs to show as a step-through slideshow (e.g. disassembly). */
  gallery?: string[];
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
}

export interface ActionStep extends StepBase {
  type: "action";
  /** Auto-runs on entry; streams to the console; drives the progress bar. */
  run: (ctx: FlowContext) => Promise<void>;
}

export interface DoneStep extends StepBase {
  type: "done";
}

/** One input on a form step. */
export interface FormField {
  key: string;
  label: string;
  placeholder?: string;
  default?: string;
  /** Render as a masked password input. */
  secret?: boolean;
}

export interface FormStep extends StepBase {
  type: "form";
  fields: FormField[];
  /** Mutable map the UI writes entered values into; the flow's action reads it. */
  values: Record<string, string>;
}

export type Step = InfoStep | ConfirmStep | ActionStep | DoneStep | FormStep;

export interface Flow {
  id: string;
  title: string;
  /** One-line summary for the "what do you want to do?" picker. */
  summary?: string;
  /** Marks a not-yet-implemented flow as the "Soon" placeholder. */
  soon?: boolean;
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
  /** Append a line to the persistent console pane (engine adds the timestamp). */
  log: (msg: string) => void;
  /** Drive the action step's progress bar (0..total). */
  progress: (done: number, total: number) => void;
  /** Resolve once the operator has picked + opened the USB device (gesture). */
  connectUsb: () => Promise<void>;
  /** Resolve once the operator has picked + opened the serial port (gesture). */
  connectSerial: (baudRate?: number) => Promise<void>;
}
