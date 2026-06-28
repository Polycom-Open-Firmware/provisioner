// Screen 2: "What do you want to do?" — lists the device's flows (Unlock /
// Reinstall Linux / Reconfigure[Soon]).
import { ChevronRight } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { Badge } from "@/components/ui/badge";

export function FlowPicker() {
  const { device, pickFlow, back } = useWizard();
  if (!device) return null;

  return (
    <div className="flex flex-1 flex-col p-10">
      <button onClick={back} className="self-start font-mono text-xs text-muted hover:text-foreground">
        ← devices
      </button>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <h1 className="text-2xl font-semibold text-foreground">What do you want to do?</h1>
        <p className="mt-1 text-sm text-body">{device.name}</p>

        <div className="mt-6 flex flex-col gap-3">
          {device.flows.map((f) => (
            <button
              key={f.id}
              disabled={f.soon}
              onClick={() => pickFlow(f)}
              className="flex items-center justify-between rounded-xl bg-background p-5 text-left shadow-soft ring-1 ring-border transition enabled:hover:ring-primary disabled:opacity-55"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{f.title}</span>
                  {f.soon && <Badge>Soon</Badge>}
                </div>
                {f.summary && <div className="mt-0.5 text-sm text-muted">{f.summary}</div>}
              </div>
              {!f.soon && <ChevronRight className="h-5 w-5 shrink-0 text-muted" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
