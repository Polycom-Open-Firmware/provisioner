// Screen 1: "Pick your device". Also surfaces the Chromium/secure-context gate —
// WebUSB + Web Serial only exist there, and the device must be WinUSB-bound.
import { AlertTriangle } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { Badge } from "@/components/ui/badge";
import { webSupport } from "@/backend";
import { DEVICE_IMAGES } from "@/lib/devices";
import { KofiBadge } from "./KofiBadge";

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
    <div className="relative flex flex-1 flex-col items-center justify-center gap-8 p-10">
      <div className="text-center">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
          Open Polycom
        </div>
        <h1 className="mt-2 text-[27px] font-bold tracking-[-0.02em] text-foreground">Pick your device</h1>
        <p className="mt-1 text-[15px] text-body">Unlock it and install Linux over USB.</p>
      </div>

      {unsupported && <UnsupportedBanner sup={sup} />}

      <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        {devices.map((d) => {
          const img = DEVICE_IMAGES[d.id];
          return (
            <button
              key={d.id}
              onClick={() => pickDevice(d)}
              className="flex flex-col items-center gap-3 rounded-[12px] p-5 text-center transition hover:bg-rail"
            >
              <div className="flex h-28 w-full items-center justify-center">
                {img ? (
                  <img
                    src={img.src}
                    alt={d.name}
                    className={`max-h-28 max-w-full object-contain ${img.scale ?? ""}`}
                  />
                ) : (
                  <span className="font-mono text-xs text-muted">{d.name}</span>
                )}
              </div>
              <div className="text-[15px] font-semibold text-foreground">{d.name}</div>
            </button>
          );
        })}

        <div className="flex flex-col items-center gap-3 rounded-[12px] p-5 text-center opacity-60">
          <div className="flex h-28 w-full items-center justify-center">
            <img src="/poly-c60.png" alt="Polycom Trio C60" className="max-h-28 max-w-full object-contain" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-foreground">Polycom Trio C60</span>
            <Badge>Soon</Badge>
          </div>
        </div>
      </div>

      <KofiBadge />
    </div>
  );
}
