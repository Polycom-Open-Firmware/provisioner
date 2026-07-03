// SPDX-License-Identifier: GPL-2.0-or-later

// NativeSerialPicker — desktop has no browser serial chooser. With exactly one
// port we just connect it (no chooser); with several we list them so the operator
// can resolve which is the device.
import * as React from "react";
import { Plug } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { PickerHeader } from "@/components/PickerHeader";
import { DeviceRow } from "@/components/DeviceRow";
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
      <PickerHeader label="Serial port" onRefresh={refresh} />

      {listErr && <div className="text-[13px] text-body">Couldn't list ports: {listErr}</div>}
      {!listErr && ports.length === 0 && (
        <div className="text-[13px] text-muted">
          No serial ports detected. Plug in the USB-serial adapter and press refresh.
        </div>
      )}

      {single &&
        (error ? (
          <DeviceRow
            title={ports[0]!.name}
            subtitle={`${ports[0]!.product || ports[0]!.kind} · try again`}
            icon={<Plug className="h-4 w-4" />}
            onClick={() => connectSerialPort(ports[0]!.name)}
          />
        ) : (
          <div className="text-[15px] text-body">Connecting to {ports[0]!.name}…</div>
        ))}

      {ports.length > 1 && (
        <>
          <p className="mb-2 text-[13px] text-body">Click a port to connect.</p>
          <div className="flex flex-col gap-2">
            {ports.map((p) => (
              <DeviceRow
                key={p.name}
                title={p.name}
                subtitle={p.product || p.kind}
                icon={<Plug className="h-4 w-4" />}
                onClick={() => connectSerialPort(p.name)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
