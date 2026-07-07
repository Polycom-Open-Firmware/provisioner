// SPDX-License-Identifier: GPL-2.0-or-later

// DangerDialog — binds the wizard's pending danger gate (a step's `danger` data)
// to the AlertDialog primitive. Mounted once in AppWindow, over the whole frame.
import { useWizard } from "@/lib/wizard";
import { AlertDialog } from "@/components/ui/alert-dialog";

export function DangerDialog() {
  const { pendingDanger, confirmDanger, cancelDanger } = useWizard();
  return (
    <AlertDialog
      open={pendingDanger !== null}
      title={pendingDanger?.gate.title ?? ""}
      message={pendingDanger?.gate.message ?? ""}
      confirmLabel={pendingDanger?.gate.confirmLabel}
      onConfirm={confirmDanger}
      onCancel={cancelDanger}
    />
  );
}
