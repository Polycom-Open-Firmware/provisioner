// SPDX-License-Identifier: GPL-2.0-or-later

import { cn } from "@/lib/utils";

export function Progress({ value = 0, className }: { value?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-[4px] bg-rail", className)}>
      <div
        className="h-full rounded-[4px] bg-primary transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
