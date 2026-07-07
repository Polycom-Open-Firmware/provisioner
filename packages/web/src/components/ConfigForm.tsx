// SPDX-License-Identifier: GPL-2.0-or-later

// ConfigForm — renders a step's form schema (StepForm: fields + optional note).
// Fully generic: the fields come from the step (device profiles compose them in
// core — see core/src/flow/settings.ts), so new devices and new settings pages
// never touch this component. Self-contained, the same way NativeSerialPicker
// is: it calls useWizard() (to dim while busy) and writes the operator's values
// into the shared config draft in @provisioner/core. The flow's apply step reads
// that draft and builds the blob — so this component never touches a transport
// and the flow never imports React. Blank fields are left as-is on the device.
//
// To show it, render the current confirm step's form from StepContent:
//     {step.form && <ConfigForm key={step.id} form={step.form} />}
import * as React from "react";
import { configStore, type ConfigFields, type StepForm } from "@provisioner/core";
import { useWizard } from "@/lib/wizard";
import { Input } from "@/components/ui/input";
import { Caption } from "@/components/ui/caption";

export function ConfigForm({ form }: { form: StepForm }) {
  const { busy } = useWizard();
  // Seed from the shared draft so values survive stepping back and forth.
  const [vals, setVals] = React.useState<Record<string, string>>(() => {
    const snap = configStore.snapshot() as Record<string, string | undefined>;
    const init: Record<string, string> = {};
    for (const f of form.fields) {
      // A picker with no saved value defaults to its first option, and we seed
      // that default into the draft so it's written even if untouched.
      const seeded = snap[f.key] ?? (f.options?.[0]?.value ?? "");
      init[f.key] = seeded;
      if (f.options && snap[f.key] == null && seeded)
        configStore.set({ [f.key]: seeded } as ConfigFields);
    }
    return init;
  });

  const update = (key: string, value: string) => {
    setVals((v) => ({ ...v, [key]: value }));
    configStore.set({ [key]: value } as ConfigFields);
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      {form.fields.map((f) =>
        f.options ? (
          <fieldset key={f.key} className="flex flex-col gap-2" disabled={busy}>
            <Caption>{f.label}</Caption>
            {f.options.map((o) => (
              <label key={o.value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={f.key}
                  value={o.value}
                  checked={(vals[f.key] ?? "") === o.value}
                  disabled={busy}
                  onChange={() => update(f.key, o.value)}
                  className="mt-1"
                />
                <span className="text-sm">{o.label}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label key={f.key} className="flex flex-col gap-1">
            <Caption>{f.label}</Caption>
            <Input
              type={f.secret ? "password" : "text"}
              value={vals[f.key] ?? ""}
              placeholder={f.placeholder}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => update(f.key, e.target.value)}
            />
          </label>
        ),
      )}
      {form.note && <p className="text-[12px] text-muted">{form.note}</p>}
    </div>
  );
}
