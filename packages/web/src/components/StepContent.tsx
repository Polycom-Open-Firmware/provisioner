// The content region. Renders per step type: info/confirm copy (+ placeholder
// asset blocks for serial/USB gestures), the action progress bar (detailed log
// streams to the Console), the done success block, and any error surface.
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { Progress } from "@/components/ui/progress";
import { Slideshow } from "./Slideshow";
import type { Gesture } from "@provisioner/core";

function fmtBytes(n: number): string {
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + " MiB";
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(0) + " KiB";
  return n + " B";
}

function kindLabel(t: string): string {
  return t === "action" ? "Installing" : t === "confirm" ? "Action needed" : t === "done" ? "Done" : "Step";
}

function GestureHint({ gesture }: { gesture: Gesture }) {
  if (gesture === "connect-serial")
    return (
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border bg-rail font-mono text-xs text-muted">
          serial header photo
        </div>
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border bg-rail font-mono text-xs text-muted">
          pinout diagram
        </div>
      </div>
    );
  if (gesture === "connect-usb")
    return (
      <div className="mt-6 flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-rail font-mono text-xs text-muted">
        USB cabling diagram
      </div>
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

      {step.gallery && step.gallery.length > 0 && <Slideshow images={step.gallery} className="mt-6" />}

      {step.type === "confirm" && step.gesture && <GestureHint gesture={step.gesture} />}

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
