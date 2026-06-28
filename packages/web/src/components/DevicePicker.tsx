// Screen 1: "Pick your device". Also surfaces the Chromium/secure-context gate —
// WebUSB + Web Serial only exist there, and the device must be WinUSB-bound.
import { AlertTriangle } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { Badge } from "@/components/ui/badge";
import { webSupport } from "@/backend";

function UnsupportedBanner({ sup }: { sup: ReturnType<typeof webSupport> }) {
  const missing = [
    !sup.usb && "WebUSB",
    !sup.serial && "Web Serial",
    !sup.secure && "a secure context (https/localhost)",
  ].filter(Boolean);
  return (
    <div className="flex max-w-xl items-start gap-2 rounded-lg border border-border bg-primary-tint2 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div>
        <div className="font-medium text-foreground">This browser can't drive a device</div>
        <div className="mt-0.5 text-body">
          Missing {missing.join(", ")}. Use Chrome or Edge over https or localhost.
        </div>
      </div>
    </div>
  );
}

export function DevicePicker() {
  const { devices, pickDevice } = useWizard();
  const sup = webSupport();
  const unsupported = !sup.usb || !sup.serial || !sup.secure;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-10">
      <div className="text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-primary">Open Polycom</div>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Pick your device</h1>
        <p className="mt-1 text-sm text-body">
          Unlock it and install Linux over USB. Nothing leaves your machine.
        </p>
      </div>

      {unsupported && <UnsupportedBanner sup={sup} />}

      <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        {devices.map((d) => (
          <button
            key={d.id}
            onClick={() => pickDevice(d)}
            className="flex flex-col items-start gap-3 rounded-xl bg-background p-5 text-left shadow-soft ring-1 ring-border transition hover:ring-primary"
          >
            <div className="flex h-24 w-full items-center justify-center rounded-lg bg-rail font-mono text-xs text-muted">
              device photo
            </div>
            <div>
              <div className="font-medium text-foreground">{d.name}</div>
              <div className="text-xs text-muted">
                {d.flows.filter((f) => !f.soon).length} guided flows
              </div>
            </div>
          </button>
        ))}

        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-background p-5 opacity-60">
          <div className="flex h-24 w-full items-center justify-center rounded-lg bg-rail font-mono text-xs text-muted">
            more soon
          </div>
          <Badge>Soon</Badge>
        </div>
      </div>
    </div>
  );
}
