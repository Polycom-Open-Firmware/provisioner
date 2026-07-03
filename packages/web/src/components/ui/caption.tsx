// SPDX-License-Identifier: GPL-2.0-or-later

import * as React from "react";
import { cn } from "@/lib/utils";

const captionBase = "font-mono text-[11px] font-semibold uppercase tracking-[0.08em]";

export interface CaptionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `muted` for field labels, `primary` for section eyebrows. */
  tone?: "muted" | "primary";
}

/** The mono uppercase eyebrow/label used above fields and section headers. */
export function Caption({ tone = "muted", className, ...props }: CaptionProps) {
  return (
    <div
      className={cn(captionBase, tone === "primary" ? "text-primary" : "text-muted", className)}
      {...props}
    />
  );
}
