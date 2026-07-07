// SPDX-License-Identifier: GPL-2.0-or-later

// The content region. Renders per step type: info/confirm copy (+ placeholder
// asset blocks for serial/USB gestures), the action progress bar (detailed log
// streams to the Console), the done success block, and any error surface.
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { Progress } from "@/components/ui/progress";
import { Slideshow } from "./Slideshow";
import { NativeSerialPicker } from "./NativeSerialPicker";
import { NativeUsbPicker } from "./NativeUsbPicker";
import { ConfigForm, type ConfigSection } from "./ConfigForm";
import { OsChooser } from "./OsChooser";
import { Caption } from "@/components/ui/caption";
import { isTauri } from "@/native/backend";
import type { Gesture } from "@provisioner/core";

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
  const { currentStep, progress, running, error, lines, awaitingStart } = useWizard();
  const step = currentStep;
  if (!step) return null;

  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  // A gesture action shows its connect UI (hint/picker) while awaiting the start
  // button; once started it shows the progress bar instead.
  const gesture = step.type === "confirm" || step.type === "action" ? step.gesture : undefined;
  const showConnectUi = step.type === "confirm" || (step.type === "action" && awaitingStart);

  return (
    <div className="mx-auto max-w-2xl p-10">
      {step.type === "done" ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-tint">
          <Check className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <Caption tone="primary">{kindLabel(step.type)}</Caption>
      )}

      <h1 className="mt-2 text-[27px] font-bold tracking-[-0.02em] text-foreground">{step.title}</h1>
      {step.body && <p className="mt-3 text-[15px] leading-relaxed text-body">{step.body}</p>}

      {step.id === "choose-os" && <OsChooser />}

      {step.id.startsWith("settings-") && (
        <ConfigForm key={step.id} section={step.id.slice("settings-".length) as ConfigSection} />
      )}

      {step.gallery && step.gallery.length > 0 && (
        <Slideshow images={step.gallery} className="mt-6" />
      )}

      {step.image && (
        <img
          src={step.image}
          alt=""
          className="mx-auto mt-6 block max-h-[min(34vh,300px)] w-auto rounded-[8px] border border-border object-contain"
        />
      )}

      {showConnectUi && gesture && !step.image && <GestureHint gesture={gesture} />}

      {showConnectUi && gesture === "connect-serial" && isTauri() && <NativeSerialPicker />}

      {showConnectUi && gesture === "connect-usb" && isTauri() && <NativeUsbPicker />}

      {step.type === "action" && !awaitingStart && (
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
          <p className="mt-3 truncate font-mono text-xs text-muted">
            {(lines[lines.length - 1]?.msg ?? "Working…").split("\n")[0]}
          </p>
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
