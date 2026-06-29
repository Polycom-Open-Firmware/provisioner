// SPDX-License-Identifier: GPL-2.0-or-later

import { Check } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { cn } from "@/lib/utils";

export function StepRail() {
  const { flow, stepIndex } = useWizard();
  if (!flow) return null;

  return (
    <aside className="w-[228px] shrink-0 border-r border-border bg-rail p-4">
      <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {flow.title}
      </div>
      <ol className="mt-4 flex flex-col">
        {flow.steps.map((s, i) => {
          const phase = i < stepIndex ? "done" : i === stepIndex ? "current" : "todo";
          return (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <span
                className={cn(
                  "flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-[4px] font-mono text-[11px] font-bold",
                  phase === "current" && "bg-primary text-primary-foreground",
                  phase === "done" && "border border-[#f3c9a8] bg-white text-primary",
                  phase === "todo" && "border border-[#e2ddd4] bg-white text-[#b8b2a8]",
                )}
              >
                {phase === "done" ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span
                className={cn(
                  "truncate text-[13px]",
                  phase === "current" && "font-semibold text-[#1c1a17]",
                  phase === "done" && "text-[#8a857c]",
                  phase === "todo" && "text-[#a8a39a]",
                )}
              >
                {s.rail}
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
