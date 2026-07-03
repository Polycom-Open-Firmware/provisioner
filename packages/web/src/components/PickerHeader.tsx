// SPDX-License-Identifier: GPL-2.0-or-later

// PickerHeader — the "<label>  refresh" row shared by the OS chooser and the native
// serial/USB pickers.
import { RefreshCw } from "lucide-react";
import { Caption } from "@/components/ui/caption";

export function PickerHeader({ label, onRefresh }: { label: string; onRefresh: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <Caption>{label}</Caption>
      <button
        onClick={onRefresh}
        className="flex items-center gap-1 font-mono text-[11px] text-muted hover:text-foreground"
      >
        <RefreshCw className="h-3 w-3" /> refresh
      </button>
    </div>
  );
}
