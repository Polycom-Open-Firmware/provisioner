// SPDX-License-Identifier: GPL-2.0-or-later

import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
