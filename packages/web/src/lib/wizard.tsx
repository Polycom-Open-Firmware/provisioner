// SPDX-License-Identifier: GPL-2.0-or-later

// wizard.tsx — the wiring. Owns a single WizardRunner (constructed with the web
// Backend + an HTTP artifact source), subscribes to its event stream, and
// projects it into React state. Components read `useWizard()`; none of them ever
// touch a transport or the runner's internals directly.
//
// Gesture rule (load-bearing): WebUSB requestDevice / Web Serial requestPort MUST
// run inside a real user click. So `primary()` calls runner.attachUsb()/
// attachSerial() synchronously from the button handler for connect-* steps; the
// action step that follows just awaits ctx.connectUsb(), which is already resolved.
import * as React from "react";
import {
  WizardRunner,
  tc8Profile,
  c60Profile,
  type Device,
  type Flow,
  type Step,
  type EngineEvent,
} from "@provisioner/core";
import { webBackend } from "@/backend";
import { isTauri, nativeBackend } from "@/native/backend";
import { HttpArtifacts } from "@/artifacts";
import { artifactsFor, type OsBuild } from "@/os-catalog";

export type Phase = "pick-device" | "pick-flow" | "in-flow";
export interface ConsoleLine {
  ts: number;
  msg: string;
}

interface WizardState {
  phase: Phase;
  device: Device | null;
  flow: Flow | null;
  stepIndex: number;
  lines: ConsoleLine[];
  progress: { done: number; total: number } | null;
  running: boolean;
  busy: boolean;
  error: string | null;
}

export interface WizardApi extends WizardState {
  devices: Device[];
  /** Which flavor is running — gates native-only flows (e.g. C60 UUU unlock). */
  platform: "web" | "native";
  currentStep: Step | null;
  pickDevice: (d: Device) => void;
  pickFlow: (f: Flow) => void;
  primary: () => void | Promise<void>;
  back: () => void;
  retry: () => void;
  restart: () => void;
  /** Native only: open a specific serial port, then advance. */
  connectSerialPort: (path: string) => Promise<void>;
  /** Native only: open a specific USB device, then advance. */
  connectUsbDevice: (dev: { vendorId: number; productId: number; serial?: string }) => Promise<void>;
  /** Pick which OS build to flash; swaps the artifact source, then advances. */
  chooseOs: (build: OsBuild) => void;
}

const initial: WizardState = {
  phase: "pick-device",
  device: null,
  flow: null,
  stepIndex: 0,
  lines: [],
  progress: null,
  running: false,
  busy: false,
  error: null,
};

function reduce(s: WizardState, e: EngineEvent): WizardState {
  switch (e.type) {
    case "flow:start":
      return { ...s, stepIndex: 0, progress: null, error: null };
    case "step:enter":
      return { ...s, stepIndex: e.index, progress: null };
    case "action:start":
      return { ...s, error: null };
    case "running":
      return { ...s, running: e.running };
    case "console":
      return { ...s, lines: [...s.lines, { ts: e.ts, msg: e.msg }].slice(-2000) };
    case "progress":
      return { ...s, progress: { done: e.done, total: e.total } };
    case "error":
      return { ...s, error: e.message, running: false };
    default:
      return s;
  }
}

const Ctx = React.createContext<WizardApi | null>(null);

export function useWizard(): WizardApi {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useWizard must be used inside <WizardProvider>");
  return v;
}

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const runnerRef = React.useRef<WizardRunner | null>(null);
  if (!runnerRef.current) {
    const backend = isTauri() ? nativeBackend() : webBackend();
    runnerRef.current = new WizardRunner({ backend, artifacts: new HttpArtifacts() });
  }
  const runner = runnerRef.current;

  const platform: "web" | "native" = isTauri() ? "native" : "web";
  const devices = React.useMemo(() => [tc8Profile(), c60Profile()], []);
  const [state, setState] = React.useState<WizardState>(initial);

  // Keep a ref of the latest state so click handlers read fresh values without
  // re-binding on every render.
  const stateRef = React.useRef(state);
  stateRef.current = state;

  React.useEffect(() => {
    return runner.events.on((e: EngineEvent) => setState((s) => reduce(s, e)));
  }, [runner]);

  const pickDevice = (d: Device) =>
    setState((s) => ({ ...s, device: d, phase: "pick-flow", error: null }));

  const pickFlow = (f: Flow) => {
    if (f.soon) return;
    if (f.nativeOnly && platform === "web") return; // greyed in the picker; refuse to start
    setState((s) => ({ ...s, flow: f, phase: "in-flow", stepIndex: 0, lines: [], progress: null, error: null }));
    runner.start(f);
  };

  const retry = () => runner.retry();

  const connectSerialPort = async (path: string) => {
    setState((x) => ({ ...x, busy: true, error: null }));
    try {
      await runner.attachSerial(115200, path);
      runner.confirm();
    } catch (err) {
      setState((x) => ({ ...x, error: (err as Error).message }));
    } finally {
      setState((x) => ({ ...x, busy: false }));
    }
  };

  const connectUsbDevice = async (dev: { vendorId: number; productId: number; serial?: string }) => {
    setState((x) => ({ ...x, busy: true, error: null }));
    try {
      await runner.attachUsb([{ vendorId: dev.vendorId, productId: dev.productId }], dev.serial);
      runner.confirm();
    } catch (err) {
      setState((x) => ({ ...x, error: (err as Error).message }));
    } finally {
      setState((x) => ({ ...x, busy: false }));
    }
  };

  const chooseOs = (build: OsBuild) => {
    runner.useArtifacts(artifactsFor(build));
    runner.confirm();
  };

  const restart = () => setState({ ...initial });

  const back = () => {
    const s = stateRef.current;
    if (s.phase === "pick-flow") {
      setState((x) => ({ ...x, phase: "pick-device", device: null, error: null }));
      return;
    }
    if (s.phase === "in-flow") {
      if (s.stepIndex > 0) runner.back();
      else setState((x) => ({ ...x, phase: "pick-flow", flow: null, error: null }));
    }
  };

  const primary = async () => {
    const s = stateRef.current;
    const step = s.flow?.steps[s.stepIndex];
    if (!step) return;

    if (step.type === "info") return runner.next();
    if (step.type === "done") return restart();
    if (step.type === "action") return; // auto-runs; no primary action

    // confirm
    const gesture = step.gesture;
    if (gesture === "connect-usb" || gesture === "connect-serial" || gesture === "connect-hid") {
      setState((x) => ({ ...x, busy: true, error: null }));
      try {
        if (gesture === "connect-usb") await runner.attachUsb(s.device?.filters);
        else if (gesture === "connect-serial") await runner.attachSerial();
        else await runner.attachHid(step.hidFilters ?? [{ vendorId: 0x1fc9 }]);
        runner.confirm();
      } catch (err) {
        setState((x) => ({ ...x, error: (err as Error).message }));
      } finally {
        setState((x) => ({ ...x, busy: false }));
      }
      return;
    }
    runner.confirm();
  };

  const currentStep: Step | null = state.flow ? state.flow.steps[state.stepIndex] ?? null : null;

  const value: WizardApi = {
    ...state,
    devices,
    platform,
    currentStep,
    pickDevice,
    pickFlow,
    primary,
    back,
    retry,
    restart,
    connectSerialPort,
    connectUsbDevice,
    chooseOs,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
