// Persistent right-docked console (Conversation & Design Notes.md, step 8):
// timestamped, a live dot while an action runs, streams across the whole flow,
// collapsible to a thin rail. Fed purely by the runner's "console" events.
import * as React from "react";
import { ChevronRight, Terminal } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { cn } from "@/lib/utils";

function hhmmss(n: number): string {
  const d = new Date(n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function Console() {
  const { lines, running } = useWizard();
  const [open, setOpen] = React.useState(true);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-9 shrink-0 flex-col items-center gap-2 border-l border-border bg-console py-3 text-console-fg"
        title="Show console"
      >
        <Terminal className="h-4 w-4" />
        <span className="font-mono text-[11px] tracking-widest [writing-mode:vertical-rl]">CONSOLE</span>
      </button>
    );
  }

  return (
    <aside className="flex w-[312px] shrink-0 flex-col border-l border-border bg-console">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2 font-mono text-xs text-console-fg">
          <span className={cn("h-[7px] w-[7px] rounded-full", running ? "animate-pulse bg-primary" : "bg-console-ts")} />
          console
        </div>
        <button onClick={() => setOpen(false)} className="text-console-ts hover:text-console-fg" title="Hide console">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={bodyRef}
        className="min-h-0 flex-1 overflow-auto px-3 pb-3 font-mono text-[12px] leading-relaxed"
      >
        {lines.length === 0 && <div className="text-console-ts">waiting…</div>}
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-console-ts">{hhmmss(l.ts)}</span>
            <span className="whitespace-pre-wrap break-words text-console-fg">{l.msg}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
