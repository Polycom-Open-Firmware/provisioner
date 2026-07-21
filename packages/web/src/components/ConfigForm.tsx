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
// grid (the Application page); plain options render as radios. Icon tiles are
// master→detail: the grid is a picker of applications, and choosing one drills
// into a page with just that application's own `fields` (per-app settings) and
// a link back to the grid — one thing per screen, inside the wizard window.
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

  // Which icon-tile picker is drilled into its selected app's config page
  // (null = showing the picker grid). Keyed by field so the grid ↔ detail
  // toggle is per-picker.
  const [drilledKey, setDrilledKey] = React.useState<string | null>(null);

  const update = (key: string, value: string) => {
    setVals((v) => ({ ...v, [key]: value }));
    configStore.set({ [key]: value } as ConfigFields);
  };

  type Option = NonNullable<FormField["options"]>[number];
  const versionBadge = (o: Option) =>
    o.badge ?? (o.pkg && versions[o.pkg] ? "v" + versions[o.pkg] : undefined);

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
    <div key={f.key} className="flex flex-col gap-1">
      <Caption>{f.label}</Caption>
      <div className="flex rounded-lg border border-border overflow-hidden w-fit">
        {f.options!.map((o) => {
          const on = (vals[f.key] ?? "") === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              aria-pressed={on}
              onClick={() => update(f.key, o.value)}
              className={
                "px-3 py-1.5 text-xs transition-colors " +
                (on ? "bg-accent/15 text-accent font-medium" : "hover:bg-accent/5")
              }
              title={o.label}
            >
              {o.label.split(" — ")[0]}
            </button>
          );
        })}
      </div>
    </div>
  );

  // The selected application's own config page: header + its fields, with a
  // link back to the picker grid.
  const appDetail = (f: FormField, o: Option) => {
    const badge = versionBadge(o);
    return (
      <div key={f.key} className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setDrilledKey(null)}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-accent w-fit -mb-1"
        >
          <span aria-hidden>←</span> Applications
        </button>
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none shrink-0" aria-hidden>{o.icon}</span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold leading-tight">{o.label}</span>
              {badge && <span className="text-[10px] text-muted/70 leading-none shrink-0">{badge}</span>}
            </div>
            {o.description && <span className="text-xs text-muted leading-snug">{o.description}</span>}
          </div>
        </div>
        {o.fields && o.fields.length > 0 ? (
          <div className="flex flex-col gap-3">
            {o.fields.map((sf) => (sf.options ? radios(sf) : textInput(sf)))}
          </div>
        ) : (
          <p className="text-xs text-muted">No further settings — {o.label} runs as-is.</p>
        )}
      </div>
    );
  };

  // Icon-tile picker as master→detail: a big grid of applications; choosing one
  // drills into its own config page. The grid keeps the current choice ringed
  // so stepping back lands on it.
  const tiles = (f: FormField) => {
    const selected = f.options!.find((o) => o.value === (vals[f.key] ?? ""));
    if (drilledKey === f.key && selected) return appDetail(f, selected);
    return (
      <div key={f.key} className="flex flex-col gap-2.5">
        {f.options!.map((o) => {
          const on = (vals[f.key] ?? "") === o.value;
          const badge = versionBadge(o);
          return (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              onClick={() => {
                update(f.key, o.value);
                setDrilledKey(f.key);
              }}
              aria-pressed={on}
              className={
                "group flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors " +
                (on
                  ? "border-accent ring-2 ring-accent bg-accent/10"
                  : "border-border hover:border-accent/50 hover:bg-accent/5")
              }
            >
              <span className="text-3xl leading-none shrink-0" aria-hidden>{o.icon}</span>
              <span className="flex flex-col min-w-0 flex-1 gap-0.5">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold leading-tight truncate">{o.label}</span>
                  {badge && (
                    <span className="text-[10px] text-muted/70 leading-none shrink-0">{badge}</span>
                  )}
                </span>
                {o.description && (
                  <span className="text-[11px] text-muted leading-snug">{o.description}</span>
                )}
              </span>
              <span
                className="text-muted/40 group-hover:text-accent shrink-0 text-lg leading-none"
                aria-hidden
              >
                ›
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mt-5 flex flex-col gap-3">
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
