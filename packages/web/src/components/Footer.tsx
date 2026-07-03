// SPDX-License-Identifier: GPL-2.0-or-later

// Footer bar: step counter (mono) + Back (borderless) + the primary button whose
// label/behavior depends on the current step type. Back is disabled while an
// action runs and is hidden from re-entering a just-completed action step.
import { Loader2 } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { Button } from "@/components/ui/button";
import { isTauri } from "@/native/backend";

export function Footer() {
  const { currentStep, stepIndex, flow, running, busy, error, awaitingStart, primary, back, retry } = useWizard();
  const step = currentStep;
  if (!step || !flow) return null;

  const isAction = step.type === "action";
  const gesture = step.type === "confirm" || step.type === "action" ? step.gesture : undefined;
  const confirmLabel = step.type === "confirm" || step.type === "action" ? step.confirmLabel : undefined;
  const actionErrored = isAction && !!error && !running && !busy;
  // Hide the footer button for a running/auto action, or when a native picker (which
  // selects + starts the step itself) handles a gesture step.
  const nativePicker = isTauri() && (gesture === "connect-serial" || gesture === "connect-usb");
  const hidePrimary = (isAction && !awaitingStart) || nativePicker;
  const prev = stepIndex > 0 ? flow.steps[stepIndex - 1] : null;
  const canBack =
    !running && !busy && !isAction && step.type !== "done" && (!prev || prev.type !== "action");

  const label =
    step.type === "info"
      ? "Next"
      : step.type === "confirm"
        ? confirmLabel ?? "Continue"
        : step.type === "done"
          ? "Back to devices"
          : awaitingStart
            ? confirmLabel ?? "Connect & continue"
            : "Working…";
  const primaryDisabled = (isAction && !awaitingStart) || running || busy;

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border px-8 py-4">
      <div className="font-mono text-[12px] font-semibold tracking-[0.04em] text-primary">
        Step {Math.min(stepIndex + 1, flow.steps.length)} of {flow.steps.length}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={back} disabled={!canBack}>
          Back
        </Button>
        {hidePrimary ? null : actionErrored ? (
          <Button variant="outline" onClick={retry}>
            Retry
          </Button>
        ) : (
          <Button onClick={primary} disabled={primaryDisabled}>
            {(running || busy) && <Loader2 className="h-4 w-4 animate-spin" />}
            {label}
          </Button>
        )}
      </div>
    </div>
  );
}
