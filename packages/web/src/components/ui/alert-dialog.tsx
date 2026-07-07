// SPDX-License-Identifier: GPL-2.0-or-later

// AlertDialog — a blocking confirm/cancel modal for destructive actions ("This
// will WIPE userdata"). Hand-rolled on purpose: the need is one controlled,
// forced-choice dialog, so radix-dialog's portal/collision machinery isn't worth
// the dependency. Forced choice: no click-outside dismiss; Escape = explicit
// Cancel. Rendered `absolute inset-0`, so mount it inside a `relative` container
// that covers the whole app frame.
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AlertDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AlertDialog({
  open,
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  // Safe default: focus lands on Cancel, so Enter never wipes a device.
  React.useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  if (!open) return null;

  // Two focusables — a 2-button Tab loop is the whole focus trap.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
      onKeyDown={onKeyDown}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-message"
        className="w-[440px] max-w-full rounded-[12px] border border-border bg-background p-6 shadow-window"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-tint">
            <AlertTriangle className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2
              id="alert-dialog-title"
              className="text-[17px] font-bold tracking-[-0.01em] text-foreground"
            >
              {title}
            </h2>
            <p id="alert-dialog-message" className="mt-1.5 text-[14px] leading-relaxed text-body">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
