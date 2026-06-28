// ConfigForm — the operator-input UI for the Configure flow's "settings" step.
// Self-contained, the same way NativeSerialPicker is: it calls useWizard() (to dim
// while busy) and writes the operator's values into the shared config draft in
// @provisioner/core. The flow's apply step reads that draft and builds the blob —
// so this component never touches a transport and the flow never imports React.
// Blank fields are left as-is on the device.
//
// To show it, render it for the Configure flow's `settings` step from StepContent:
//     import { ConfigForm } from "./ConfigForm";
//     {step.id === "settings" && <ConfigForm />}
import * as React from "react";
import { configStore, type ConfigFields, type ConfigKey } from "@provisioner/core";
import { useWizard } from "@/lib/wizard";

interface FieldDef {
  key: ConfigKey;
  label: string;
  placeholder: string;
  type?: "text" | "password";
}

// A minimal, common subset of the v1 keys (full schema: CONFIG-PARTITION.md).
const FIELDS: FieldDef[] = [
  { key: "DEVICE_NAME", label: "Device name", placeholder: "lobby-east" },
  { key: "KIOSK_URL", label: "Kiosk URL", placeholder: "https://dash.local  or  rtsp://…" },
  { key: "TIMEZONE", label: "Time zone", placeholder: "America/New_York" },
  { key: "NTP_SERVER", label: "NTP server", placeholder: "192.168.1.1" },
  { key: "ROOT_PASSWORD", label: "Root password", placeholder: "leave blank to keep current", type: "password" },
  { key: "SSH_AUTHKEY", label: "SSH public key", placeholder: "ssh-ed25519 AAAA…" },
];

export function ConfigForm() {
  const { busy } = useWizard();
  // Seed from the shared draft so values survive stepping back and forth.
  const [vals, setVals] = React.useState<Record<string, string>>(() => {
    const snap = configStore.snapshot();
    const init: Record<string, string> = {};
    for (const f of FIELDS) init[f.key] = snap[f.key] ?? "";
    return init;
  });

  const update = (key: ConfigKey, value: string) => {
    setVals((v) => ({ ...v, [key]: value }));
    configStore.set({ [key]: value } as ConfigFields);
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            {f.label}
          </span>
          <input
            type={f.type ?? "text"}
            value={vals[f.key] ?? ""}
            placeholder={f.placeholder}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => update(f.key, e.target.value)}
            className="rounded-[8px] border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted focus:border-primary focus:outline-none disabled:opacity-55"
          />
        </label>
      ))}
      <p className="text-[12px] text-muted">
        Fields left blank stay as they are on the device. Values are stored in plain text on the
        device — see CONFIG-PARTITION.md.
      </p>
    </div>
  );
}
