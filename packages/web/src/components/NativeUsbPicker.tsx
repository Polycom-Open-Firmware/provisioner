// SPDX-License-Identifier: GPL-2.0-or-later

// NativeUsbPicker — desktop has no browser USB chooser. With exactly one matching
// device we just connect it; with several we list them so the operator can pick.
import * as React from "react";
import { Usb } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { PickerHeader } from "@/components/PickerHeader";
import { DeviceRow } from "@/components/DeviceRow";
import { listUsbDevices, type UsbDeviceDesc } from "@/native/backend";

const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const label = (d: UsbDeviceDesc) => `${hex4(d.vendorId)}:${hex4(d.productId)}${d.serial ? ` · ${d.serial}` : ""}`;

export function NativeUsbPicker() {
  const { device, connectUsbDevice, error } = useWizard();
  const [devices, setDevices] = React.useState<UsbDeviceDesc[]>([]);
  const [listErr, setListErr] = React.useState<string | null>(null);
  const connectRef = React.useRef(connectUsbDevice);
  connectRef.current = connectUsbDevice;

  const refresh = React.useCallback(async () => {
    try {
      const list = await listUsbDevices(device?.filters ?? []);
      setListErr(null);
      setDevices(list);
      if (list.length === 1) void connectRef.current(list[0]!); // one device -> just connect
    } catch (e) {
      setListErr((e as Error).message);
    }
  }, [device]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const single = devices.length === 1 && !listErr;

  return (
    <div className="mt-6">
      <PickerHeader label="USB device" onRefresh={refresh} />

      {listErr && <div className="text-[13px] text-body">Couldn't list devices: {listErr}</div>}
      {!listErr && devices.length === 0 && (
        <div className="text-[13px] text-muted">
          No device in fastboot detected. Put the device into fastboot and press refresh.
        </div>
      )}

      {single &&
        (error ? (
          <DeviceRow
            title={devices[0]!.product || "USB device"}
            subtitle={`${label(devices[0]!)} · try again`}
            icon={<Usb className="h-4 w-4" />}
            onClick={() => connectUsbDevice(devices[0]!)}
          />
        ) : (
          <div className="text-[15px] text-body">Connecting to {devices[0]!.product || "the device"}…</div>
        ))}

      {devices.length > 1 && (
        <>
          <p className="mb-2 text-[13px] text-body">Click your device to connect.</p>
          <div className="flex flex-col gap-2">
            {devices.map((d, i) => (
              <DeviceRow
                key={(d.serial ?? "") + i}
                title={d.product || "USB device"}
                subtitle={label(d)}
                icon={<Usb className="h-4 w-4" />}
                onClick={() => connectUsbDevice(d)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
