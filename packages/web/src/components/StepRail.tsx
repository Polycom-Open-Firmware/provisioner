import { Check } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { cn } from "@/lib/utils";

export function StepRail() {
  const { flow, stepIndex } = useWizard();
  if (!flow) return null;

  return (
    <aside className="w-52 shrink-0 border-r border-border bg-rail p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted">{flow.title}</div>
      <ol className="mt-4 flex flex-col gap-1">
        {flow.steps.map((s, i) => {
          const phase = i < stepIndex ? "done" : i === stepIndex ? "current" : "todo";
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                phase === "current" && "bg-primary-tint2 text-foreground",
                phase === "done" && "text-body",
                phase === "todo" && "text-muted",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]",
                  phase === "current"
                    ? "bg-primary text-primary-foreground"
                    : phase === "done"
                      ? "bg-primary-tint text-primary"
                      : "bg-background text-muted ring-1 ring-border",
                )}
              >
                {phase === "done" ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="truncate">{s.rail}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
