// SPDX-License-Identifier: GPL-2.0-or-later

// runner.ts — drives one Flow through its steps and emits events the wizard UI
// renders. The UI calls next()/back()/confirm(); `action` steps auto-run on
// entry. USB/serial selection must originate from a real user click, so the UI
// calls attachUsb()/attachSerial() from its gesture-button handler; action steps
// that need a channel await ctx.connectUsb()/connectSerial(), which resolve once
// the gesture has attached it (mirrors the pathfinder's awaitUsb pattern).
import type { Backend, HidFilter, HidTransport, UsbFilter } from "../transport/transport";
import { Fastboot, FASTBOOT_FILTERS } from "../protocol/fastboot";
import { UBootConsole } from "../protocol/uboot-console";
import { Sdp } from "../protocol/sdp";
import type { Artifacts, Flow, FlowContext, Step } from "./types";
import { Emitter, defer, type Deferred } from "./emitter";

/** A HID transport that errors on use — for backends with no HID (SDP) path, so
 *  ctx.sdp always exists but SDP-based flows fail clearly rather than null-deref. */
function unavailableHid(): HidTransport {
  const no = (): Promise<never> =>
    Promise.reject(new Error("this backend has no HID (SDP) transport"));
  return { info: null, connected: false, open: no, close: no, sendReport: no, readReport: no };
}

export interface RunnerOptions {
  backend: Backend;
  artifacts: Artifacts;
}

export class WizardRunner {
  readonly events = new Emitter();
  private readonly backend: Backend;
  private artifacts: Artifacts;
  private readonly fb: Fastboot;
  private readonly uboot: UBootConsole;
  private readonly sdp: Sdp;

  private flow: Flow | null = null;
  private index = -1;
  private usbReady: Deferred<void> | null = null;
  private serialReady: Deferred<void> | null = null;
  private hidReady: Deferred<void> | null = null;

  constructor(opts: RunnerOptions) {
    this.backend = opts.backend;
    this.artifacts = opts.artifacts;
    this.fb = new Fastboot(this.backend.usb());
    this.uboot = new UBootConsole(this.backend.serial());
    this.sdp = new Sdp(this.backend.hid ? this.backend.hid() : unavailableHid());
  }

  get currentStep(): Step | null {
    return this.flow && this.index >= 0 ? this.flow.steps[this.index] ?? null : null;
  }

  /** Begin a flow at its first step. */
  start(flow: Flow): void {
    this.flow = flow;
    this.index = -1;
    this.events.emit({ type: "flow:start", flowId: flow.id, steps: flow.steps.length });
    void this.enter(0);
  }

  /** Advance from a confirm/info/done step. (action steps advance themselves.) */
  next(): void {
    if (!this.flow) return;
    const step = this.currentStep;
    if (step && step.type === "action") return; // action advances on completion
    void this.enter(this.index + 1);
  }

  back(): void {
    if (!this.flow || this.index <= 0) return;
    void this.enter(this.index - 1);
  }

  /** Re-run the current action step — recover from a failed action (e.g. a missed trap). */
  retry(): void {
    const step = this.currentStep;
    if (step && step.type === "action") void this.enter(this.index);
  }

  /** Swap the artifact source (the OS chooser picks which OS build to flash). */
  useArtifacts(a: Artifacts): void {
    this.artifacts = a;
  }

  /** Confirm the current confirm-step (same as next, named for the UI's intent). */
  confirm(): void {
    this.next();
  }

  /**
   * Called from the gesture button's click handler. Opens the fastboot device
   * (requestDevice runs here, inside the user gesture) and unblocks any action
   * step awaiting ctx.connectUsb().
   */
  async attachUsb(filters: UsbFilter[] = FASTBOOT_FILTERS, serial?: string): Promise<void> {
    await this.fb.connect(filters, serial);
    this.usbReady?.resolve();
  }

  /** Called from the gesture button's click handler; opens the serial console. */
  async attachSerial(baudRate = 115200, path?: string): Promise<void> {
    await this.uboot.serial.open({ baudRate, path });
    this.serialReady?.resolve();
  }

  /** Called from the gesture button's click handler; opens a HID (SDP) device.
   *  requestDevice must run inside the user gesture, so this happens on click. */
  async attachHid(filters: HidFilter[]): Promise<void> {
    await this.sdp.hid.open(filters);
    this.hidReady?.resolve();
  }

  private context(): FlowContext {
    const log = (msg: string) =>
      this.events.emit({ type: "console", ts: Date.now(), msg });
    const progress = (done: number, total: number) =>
      this.events.emit({ type: "progress", done, total });
    const connectUsb = () => {
      if (this.fb.connected) return Promise.resolve();
      this.usbReady = defer<void>();
      return this.usbReady.promise;
    };
    const connectSerial = (_baudRate?: number) => {
      if (this.uboot.connected) return Promise.resolve();
      this.serialReady = defer<void>();
      return this.serialReady.promise;
    };
    // Unlike USB/serial, each SDP stage opens a DIFFERENT HID device (BootROM then
    // the SPL gadget), so connectHid always waits for the fresh gesture's attach.
    const connectHid = () => {
      this.hidReady = defer<void>();
      return this.hidReady.promise;
    };
    return {
      backend: this.backend,
      artifacts: this.artifacts,
      fb: this.fb,
      uboot: this.uboot,
      sdp: this.sdp,
      log,
      progress,
      connectUsb,
      connectSerial,
      connectHid,
    };
  }

  private async enter(index: number): Promise<void> {
    if (!this.flow) return;
    if (index >= this.flow.steps.length) {
      this.events.emit({ type: "flow:done", flowId: this.flow.id });
      return;
    }
    this.index = index;
    const step = this.flow.steps[index]!;
    this.events.emit({ type: "step:enter", index, stepId: step.id });

    if (step.type !== "action") return;

    this.events.emit({ type: "action:start", index });
    this.events.emit({ type: "running", running: true });
    try {
      await step.run(this.context());
      this.events.emit({ type: "action:done", index });
      this.events.emit({ type: "running", running: false });
      void this.enter(index + 1); // action steps auto-advance on success
    } catch (e) {
      this.events.emit({ type: "running", running: false });
      this.events.emit({ type: "error", index, message: (e as Error).message });
    }
  }
}
