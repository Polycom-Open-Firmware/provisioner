// NativeSerialPicker — desktop has no browser serial chooser. With exactly one
// port we just connect it (no chooser); with several we list them so the operator
// can resolve which is the device.
import * as React from "react";
import { Plug, RefreshCw } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { listSerialPorts, type SerialPortDesc } from "@/native/backend";

export function NativeSerialPicker() {
  const { connectSerialPort, error } = useWizard();
  const [ports, setPorts] = React.useState<SerialPortDesc[]>([]);
  const [listErr, setListErr] = React.useState<string | null>(null);
  const connectRef = React.useRef(connectSerialPort);
  connectRef.current = connectSerialPort;

  const refresh = React.useCallback(async () => {
    try {
      const list = await listSerialPorts();
      setListErr(null);
      setPorts(list);
      if (list.length === 1) void connectRef.current(list[0]!.name); // one port -> just connect
    } catch (e) {
      setListErr((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const single = ports.length === 1 && !listErr;

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Serial port
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 font-mono text-[11px] text-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>

      {listErr && <div className="text-[13px] text-body">Couldn't list ports: {listErr}</div>}
      {!listErr && ports.length === 0 && (
        <div className="text-[13px] text-muted">
          No serial ports detected. Plug in the USB-serial adapter and press refresh.
        </div>
      )}

      {single &&
        (error ? (
          <button
            onClick={() => connectSerialPort(ports[0]!.name)}
            className="flex w-full items-center justify-between rounded-[8px] border border-border bg-background px-4 py-3 text-left transition hover:border-primary"
          >
            <div>
              <div className="text-[15px] font-semibold text-foreground">{ports[0]!.name}</div>
              <div className="text-[12px] text-muted">{ports[0]!.product || ports[0]!.kind} · try again</div>
            </div>
            <Plug className="h-4 w-4 shrink-0 text-muted" />
          </button>
        ) : (
          <div className="text-[15px] text-body">Connecting to {ports[0]!.name}…</div>
        ))}

      {ports.length > 1 && (
        <>
          <p className="mb-2 text-[13px] text-body">Click a port to connect.</p>
          <div className="flex flex-col gap-2">
            {ports.map((p) => (
              <button
                key={p.name}
                onClick={() => connectSerialPort(p.name)}
                className="flex items-center justify-between rounded-[8px] border border-border bg-background px-4 py-3 text-left transition hover:border-primary"
              >
                <div>
                  <div className="text-[15px] font-semibold text-foreground">{p.name}</div>
                  <div className="text-[12px] text-muted">{p.product || p.kind}</div>
                </div>
                <Plug className="h-4 w-4 shrink-0 text-muted" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
