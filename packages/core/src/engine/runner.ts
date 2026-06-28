// runner.ts — drives one Flow through its steps and emits events the wizard UI
// renders. The UI calls next()/back()/confirm(); `action` steps auto-run on
// entry. USB/serial selection must originate from a real user click, so the UI
// calls attachUsb()/attachSerial() from its gesture-button handler; action steps
// that need a channel await ctx.connectUsb()/connectSerial(), which resolve once
// the gesture has attached it (mirrors the pathfinder's awaitUsb pattern).
import type { Backend, UsbFilter } from "../transport/transport";
import { Fastboot, FASTBOOT_FILTERS } from "../protocol/fastboot";
import { UBootConsole } from "../protocol/uboot-console";
import type { Artifacts, Flow, FlowContext, Step } from "./types";
import { Emitter, defer, type Deferred } from "./emitter";

export interface RunnerOptions {
  backend: Backend;
  artifacts: Artifacts;
}

export class WizardRunner {
  readonly events = new Emitter();
  private readonly backend: Backend;
  private readonly artifacts: Artifacts;
  private readonly fb: Fastboot;
  private readonly uboot: UBootConsole;

  private flow: Flow | null = null;
  private index = -1;
  private usbReady: Deferred<void> | null = null;
  private serialReady: Deferred<void> | null = null;

  constructor(opts: RunnerOptions) {
    this.backend = opts.backend;
    this.artifacts = opts.artifacts;
    this.fb = new Fastboot(this.backend.usb());
    this.uboot = new UBootConsole(this.backend.serial());
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

  /** Confirm the current confirm-step (same as next, named for the UI's intent). */
  confirm(): void {
    this.next();
  }

  /**
   * Called from the gesture button's click handler. Opens the fastboot device
   * (requestDevice runs here, inside the user gesture) and unblocks any action
   * step awaiting ctx.connectUsb().
   */
  async attachUsb(filters: UsbFilter[] = FASTBOOT_FILTERS): Promise<void> {
    await this.fb.connect(filters);
    this.usbReady?.resolve();
  }

  /** Called from the gesture button's click handler; opens the serial console. */
  async attachSerial(baudRate = 115200): Promise<void> {
    await this.uboot.serial.open({ baudRate });
    this.serialReady?.resolve();
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
    return {
      backend: this.backend,
      artifacts: this.artifacts,
      fb: this.fb,
      uboot: this.uboot,
      log,
      progress,
      connectUsb,
      connectSerial,
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
