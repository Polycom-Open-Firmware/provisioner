// The content region. Renders per step type: info/confirm copy (+ placeholder
// asset blocks for serial/USB gestures), the action progress bar (detailed log
// streams to the Console), the done success block, and any error surface.
import * as React from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { Progress } from "@/components/ui/progress";
import { Slideshow } from "./Slideshow";
import { NativeSerialPicker } from "./NativeSerialPicker";
import { NativeUsbPicker } from "./NativeUsbPicker";
import { isTauri } from "@/native/backend";
import type { FormStep, Gesture } from "@provisioner/core";

function fmtBytes(n: number): string {
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + " MiB";
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(0) + " KiB";
  return n + " B";
}

function kindLabel(t: string): string {
  return t === "action" ? "Installing" : t === "confirm" ? "Action needed" : t === "done" ? "Done" : "Step";
}

// The serial cable, end to end: TC8 connector -> level shifter -> USB-to-serial.
const SERIAL_PARTS = [
  { src: "/serial/tc8-end.jpg", label: "TC8 connector — GH1.25 4P" },
  { src: "/serial/level-shifter.jpg", label: "Level shifter" },
  { src: "/serial/usb-to-serial.jpg", label: "USB-to-serial" },
];

// Renders a form step's fields, writing entered values through to step.values
// (the same object the flow's action step reads) so untouched defaults still apply.
function StepForm({ step }: { step: FormStep }) {
  const [vals, setVals] = React.useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of step.fields) init[f.key] = step.values[f.key] ?? f.default ?? "";
    Object.assign(step.values, init);
    return init;
  });
  const set = (key: string, v: string) => {
    setVals((p) => ({ ...p, [key]: v }));
    step.values[key] = v;
  };
  return (
    <div className="mt-6 flex flex-col gap-4">
      {step.fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-body">{f.label}</span>
          <input
            type={f.secret ? "password" : "text"}
            value={vals[f.key] ?? ""}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={f.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="rounded-[8px] border border-border bg-background px-3 py-2 text-[15px] text-foreground outline-none transition placeholder:text-muted focus:border-primary"
          />
        </label>
      ))}
    </div>
  );
}

function GestureHint({ gesture }: { gesture: Gesture }) {
  if (gesture === "connect-serial")
    return (
      <Slideshow
        images={SERIAL_PARTS.map((p) => p.src)}
        captions={SERIAL_PARTS.map((p) => p.label)}
        className="mt-6"
      />
    );
  if (gesture === "connect-usb")
    return (
      <img
        src="/usb-otg.jpg"
        alt="USB-C cable connected to the device"
        className="mx-auto mt-6 block max-h-[min(34vh,300px)] w-auto rounded-[8px] border border-border object-contain"
      />
    );
  return null;
}

export function StepContent() {
  const { currentStep, progress, running, error } = useWizard();
  const step = currentStep;
  if (!step) return null;

  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <div className="mx-auto max-w-2xl p-10">
      {step.type === "done" ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-tint">
          <Check className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
          {kindLabel(step.type)}
        </div>
      )}

      <h1 className="mt-2 text-[27px] font-bold tracking-[-0.02em] text-foreground">{step.title}</h1>
      {step.body && <p className="mt-3 text-[15px] leading-relaxed text-body">{step.body}</p>}

      {step.gallery && step.gallery.length > 0 && (
        <Slideshow images={step.gallery} className="mt-6" />
      )}

      {step.type === "form" && <StepForm step={step} />}

      {step.type === "confirm" && step.gesture && <GestureHint gesture={step.gesture} />}

      {step.type === "confirm" && step.gesture === "connect-serial" && isTauri() && <NativeSerialPicker />}

      {step.type === "confirm" && step.gesture === "connect-usb" && isTauri() && <NativeUsbPicker />}

      {step.type === "action" && (
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-body">
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Check className="h-4 w-4 text-primary" />
              )}
              {running ? "Working…" : "Complete"}
            </span>
            {progress && (
              <span className="font-mono text-xs text-muted">
                {fmtBytes(progress.done)} / {fmtBytes(progress.total)}
              </span>
            )}
          </div>
          <Progress value={pct} />
          <p className="mt-3 text-xs text-muted">Detailed output streams in the console on the right.</p>
        </div>
      )}

      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-primary-tint2 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <div className="font-medium text-foreground">Something went wrong</div>
            <div className="mt-0.5 text-body">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}
