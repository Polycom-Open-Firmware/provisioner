// NativeSerialPicker — the desktop app has no browser serial chooser, so on the
// "connect serial" step we list the host's serial ports (via the Rust backend)
// and let the operator pick one. Picking opens it and advances.
import * as React from "react";
import { Plug, RefreshCw } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { listSerialPorts, type SerialPortDesc } from "@/native/backend";

export function NativeSerialPicker() {
  const { connectSerialPort, busy } = useWizard();
  const [ports, setPorts] = React.useState<SerialPortDesc[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setPorts(await listSerialPorts());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Serial ports
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 font-mono text-[11px] text-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>

      {err && <div className="text-[13px] text-body">Couldn't list ports: {err}</div>}
      {!err && ports.length === 0 && (
        <div className="text-[13px] text-muted">
          No serial ports detected. Plug in the USB-serial adapter and press refresh.
        </div>
      )}
      {ports.length > 0 && <p className="mb-2 text-[13px] text-body">Click a port to connect.</p>}

      <div className="flex flex-col gap-2">
        {ports.map((p) => (
          <button
            key={p.name}
            disabled={busy}
            onClick={() => connectSerialPort(p.name)}
            className="flex items-center justify-between rounded-[8px] border border-border bg-background px-4 py-3 text-left transition enabled:hover:border-primary disabled:opacity-55"
          >
            <div>
              <div className="text-[15px] font-semibold text-foreground">{p.name}</div>
              <div className="text-[12px] text-muted">{p.product || p.kind}</div>
            </div>
            <Plug className="h-4 w-4 shrink-0 text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
