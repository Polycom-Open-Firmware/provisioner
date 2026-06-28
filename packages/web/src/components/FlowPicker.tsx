// Screen 2: "What do you want to do?" — lists the device's flows (Unlock /
// Reinstall Linux / Reconfigure[Soon]).
import { ChevronRight } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { Badge } from "@/components/ui/badge";
import { DEVICE_IMAGES } from "@/lib/devices";

export function FlowPicker() {
  const { device, pickFlow, back } = useWizard();
  if (!device) return null;
  const img = DEVICE_IMAGES[device.id];

  return (
    <div className="flex flex-1 flex-col p-10">
      <button onClick={back} className="self-start font-mono text-xs text-muted hover:text-foreground">
        ← devices
      </button>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        {img && (
          <img
            src={img.src}
            alt={device.name}
            className={`mb-3 h-24 object-contain object-left ${img.scale ?? ""}`}
          />
        )}
        <h1 className="text-[27px] font-bold tracking-[-0.02em] text-foreground">What do you want to do?</h1>
        <p className="mt-1 text-[15px] text-body">{device.name}</p>

        <div className="mt-6 border-t border-border">
          {device.flows.map((f) => (
            <button
              key={f.id}
              disabled={f.soon}
              onClick={() => pickFlow(f)}
              className="flex w-full items-center justify-between gap-4 border-b border-border px-1 py-[17px] text-left transition enabled:hover:bg-rail disabled:opacity-55"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-foreground">{f.title}</span>
                  {f.soon && <Badge>Soon</Badge>}
                </div>
                {f.summary && <div className="mt-0.5 text-[13px] text-muted">{f.summary}</div>}
              </div>
              {!f.soon && <ChevronRight className="h-5 w-5 shrink-0 text-muted" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
