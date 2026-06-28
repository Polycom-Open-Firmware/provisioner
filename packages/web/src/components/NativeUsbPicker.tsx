// NativeUsbPicker — desktop has no browser USB chooser, so on a "connect over
// USB" step we list matching USB devices (via the Rust backend) and let the
// operator pick one. Picking opens it (by serial) and advances.
import * as React from "react";
import { RefreshCw, Usb } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { listUsbDevices, type UsbDeviceDesc } from "@/native/backend";

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

export function NativeUsbPicker() {
  const { device, connectUsbDevice, busy } = useWizard();
  const [devices, setDevices] = React.useState<UsbDeviceDesc[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setDevices(await listUsbDevices(device?.filters ?? []));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [device]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          USB devices
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 font-mono text-[11px] text-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>

      {err && <div className="text-[13px] text-body">Couldn't list devices: {err}</div>}
      {!err && devices.length === 0 && (
        <div className="text-[13px] text-muted">
          No device in fastboot detected. Put the device into fastboot and press refresh.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {devices.map((d, i) => (
          <button
            key={(d.serial ?? "") + i}
            disabled={busy}
            onClick={() => connectUsbDevice(d)}
            className="flex items-center justify-between rounded-[8px] border border-border bg-background px-4 py-3 text-left transition enabled:hover:border-primary disabled:opacity-55"
          >
            <div>
              <div className="text-[15px] font-semibold text-foreground">{d.product || "USB device"}</div>
              <div className="font-mono text-[12px] text-muted">
                {hex4(d.vendorId)}:{hex4(d.productId)}
                {d.serial ? ` · ${d.serial}` : ""}
              </div>
            </div>
            <Usb className="h-4 w-4 shrink-0 text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
