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
// Picker fields (FormField.options): options with an `icon` render as a tile
// grid (the Application page); plain options render as radios. A selected
// option's own `fields` render beneath the picker (per-app settings).
import * as React from "react";
import { configStore, type ConfigFields, type FormField, type StepForm } from "@provisioner/core";
import { useWizard } from "@/lib/wizard";
import { Input } from "@/components/ui/input";
import { Caption } from "@/components/ui/caption";
import { getAppVersions } from "@/app-versions";

function seedDefaults(fields: FormField[], snap: Record<string, string | undefined>, init: Record<string, string>) {
  for (const f of fields) {
    const seeded = snap[f.key] ?? (f.options?.[0]?.value ?? "");
    init[f.key] = seeded;
    if (f.options && snap[f.key] == null && seeded)
      configStore.set({ [f.key]: seeded } as ConfigFields);
    // Seed one level of per-option nested fields.
    for (const o of f.options ?? []) if (o.fields) seedDefaults(o.fields, snap, init);
  }
}

export function ConfigForm({ form }: { form: StepForm }) {
  const { busy } = useWizard();
  // Seed from the shared draft so values survive stepping back and forth.
  const [vals, setVals] = React.useState<Record<string, string>>(() => {
    const snap = configStore.snapshot() as Record<string, string | undefined>;
    const init: Record<string, string> = {};
    seedDefaults(form.fields, snap, init);
    return init;
  });

  // Version badges for application tiles (archive's published = latest).
  const [versions, setVersions] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    let on = true;
    getAppVersions().then((v) => on && setVersions(v));
    return () => { on = false; };
  }, []);

  const update = (key: string, value: string) => {
    setVals((v) => ({ ...v, [key]: value }));
    configStore.set({ [key]: value } as ConfigFields);
  };

  const textInput = (f: FormField) => (
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
  );

  const radios = (f: FormField) => (
    <fieldset key={f.key} className="flex flex-col gap-2" disabled={busy}>
      <Caption>{f.label}</Caption>
      {f.options!.map((o) => (
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
  );

  const tiles = (f: FormField) => {
    const selected = f.options!.find((o) => o.value === (vals[f.key] ?? ""));
    return (
      <div key={f.key} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {f.options!.map((o) => {
            const on = (vals[f.key] ?? "") === o.value;
            return (
              <button
                key={o.value}
                type="button"
                disabled={busy}
                onClick={() => update(f.key, o.value)}
                aria-pressed={on}
                className={
                  "flex flex-col items-center gap-1.5 rounded-xl border p-4 text-center transition-colors " +
                  (on
                    ? "border-accent ring-2 ring-accent bg-accent/10"
                    : "border-border hover:border-accent/50")
                }
              >
                <span className="text-3xl leading-none" aria-hidden>{o.icon}</span>
                <span className="text-sm font-medium">{o.label}</span>
                {o.description && (
                  <span className="text-[11px] text-muted leading-tight">{o.description}</span>
                )}
                {(o.badge ?? (o.pkg && versions[o.pkg] && "v" + versions[o.pkg])) && (
                  <span className="text-[10px] text-muted/70 leading-none">
                    {o.badge ?? "v" + versions[o.pkg!]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {selected?.fields && selected.fields.length > 0 && (
          <div className="flex flex-col gap-4 border-l-2 border-accent/30 pl-4">
            {selected.fields.map((sf) => (sf.options ? radios(sf) : textInput(sf)))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      {form.fields.map((f) =>
        f.options
          ? f.options.some((o) => o.icon)
            ? tiles(f)
            : radios(f)
          : textInput(f),
      )}
      {form.note && <p className="text-[12px] text-muted">{form.note}</p>}
    </div>
  );
}
