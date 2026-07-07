// SPDX-License-Identifier: GPL-2.0-or-later

// The left step list. Two-tier: consecutive steps sharing a `group` label fold
// into one numbered header with indented sub-items, so a flow like Unlock reads
// "1 Setup (Choose OS / Device / Network / Access), 2 Open the case, …" instead
// of a wall of nine numbered rows. Ungrouped flows render exactly as before.
import { Check } from "lucide-react";
import type { Step } from "@provisioner/core";
import { useWizard } from "@/lib/wizard";
import { cn } from "@/lib/utils";
import { Caption } from "@/components/ui/caption";

interface RailItem {
  step: Step;
  index: number;
}

type RailEntry =
  | { kind: "step"; step: Step; index: number }
  | { kind: "group"; label: string; items: RailItem[] };

/** Fold consecutive steps sharing `group` into one group entry. */
function railEntries(steps: Step[]): RailEntry[] {
  const entries: RailEntry[] = [];
  steps.forEach((step, index) => {
    const last = entries[entries.length - 1];
    if (step.group && last?.kind === "group" && last.label === step.group) {
      last.items.push({ step, index });
    } else if (step.group) {
      entries.push({ kind: "group", label: step.group, items: [{ step, index }] });
    } else {
      entries.push({ kind: "step", step, index });
    }
  });
  return entries;
}

function Badge({ phase, ordinal }: { phase: string; ordinal: number }) {
  return (
    <span
      className={cn(
        "flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-[4px] font-mono text-[11px] font-bold",
        phase === "current" && "bg-primary text-primary-foreground",
        phase === "done" && "border border-[#f3c9a8] bg-white text-primary",
        phase === "todo" && "border border-[#e2ddd4] bg-white text-[#b8b2a8]",
      )}
    >
      {phase === "done" ? <Check className="h-3 w-3" /> : ordinal}
    </span>
  );
}

function RailLabel({ phase, children }: { phase: string; children: string }) {
  return (
    <span
      className={cn(
        "truncate text-[13px]",
        phase === "current" && "font-semibold text-[#1c1a17]",
        phase === "done" && "text-[#8a857c]",
        phase === "todo" && "text-[#a8a39a]",
      )}
    >
      {children}
    </span>
  );
}

export function StepRail() {
  const { flow, stepIndex } = useWizard();
  if (!flow) return null;

  const phaseOf = (i: number) => (i < stepIndex ? "done" : i === stepIndex ? "current" : "todo");

  return (
    <aside className="w-[228px] shrink-0 border-r border-border bg-rail p-4">
      <Caption>{flow.title}</Caption>
      <ol className="mt-4 flex flex-col">
        {railEntries(flow.steps).map((entry, n) => {
          if (entry.kind === "step") {
            const phase = phaseOf(entry.index);
            return (
              <li key={entry.step.id} className="flex items-center gap-3 py-2">
                <Badge phase={phase} ordinal={n + 1} />
                <RailLabel phase={phase}>{entry.step.rail}</RailLabel>
              </li>
            );
          }
          // items is non-empty by construction (a group entry starts with one item)
          const first = entry.items[0]!.index;
          const last = entry.items[entry.items.length - 1]!.index;
          const phase = stepIndex > last ? "done" : stepIndex >= first ? "current" : "todo";
          return (
            <li key={entry.label} className="py-2">
              <div className="flex items-center gap-3">
                <Badge phase={phase} ordinal={n + 1} />
                <RailLabel phase={phase}>{entry.label}</RailLabel>
              </div>
              <ol className="ml-[10px] mt-1 flex flex-col border-l border-[#e2ddd4] pl-[18px]">
                {entry.items.map(({ step, index }) => {
                  const sub = phaseOf(index);
                  return (
                    <li key={step.id} className="flex items-center gap-2 py-1.5">
                      {sub === "done" ? (
                        <Check className="h-3 w-3 shrink-0 text-primary" />
                      ) : (
                        <span
                          className={cn(
                            "mx-[3px] h-1.5 w-1.5 shrink-0 rounded-full",
                            sub === "current" ? "bg-primary" : "bg-[#e2ddd4]",
                          )}
                        />
                      )}
                      <RailLabel phase={sub}>{step.rail}</RailLabel>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
