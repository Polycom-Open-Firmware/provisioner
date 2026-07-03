// SPDX-License-Identifier: GPL-2.0-or-later

// OsChooser — lists the available OS builds (the selected device's firmware-repo
// GitHub releases, plus the temporary local artifacts in local dev) as a compact
// dropdown. The newest build is auto-selected, so a single option needs no
// interaction; picking another swaps the artifact source (Continue advances).
// Rendered on Setup / Choose-OS screens.
import * as React from "react";
import { useWizard } from "@/lib/wizard";
import { Select } from "@/components/ui/select";
import { PickerHeader } from "@/components/PickerHeader";
import { listOsBuilds, type DeviceId, type OsBuild } from "@/os-catalog";

function optionLabel(b: OsBuild): string {
  const tags = [b.prerelease ? "pre" : null, b.local ? "dev" : null].filter(Boolean).join(" · ");
  const where = b.local ? "./artifacts" : b.tag;
  return `${b.name}${tags ? ` · ${tags}` : ""} — ${where}`;
}

export function OsChooser() {
  const { selectOs, selectedOs, device } = useWizard();
  const deviceId = (device?.id as DeviceId) ?? "tc8";
  const [builds, setBuilds] = React.useState<OsBuild[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const refresh = React.useCallback(
    async (fresh = false) => {
      setBuilds(null);
      setErr(null);
      try {
        setBuilds(await listOsBuilds(deviceId, fresh));
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [deviceId],
  );

  React.useEffect(() => {
    void refresh(false);
  }, [refresh]);

  // Auto-select the newest build once loaded (and if the current pick vanished on
  // a refresh) — so a single option is zero-click and Continue always has a build.
  React.useEffect(() => {
    if (!builds || builds.length === 0) return;
    if (!selectedOs || !builds.some((b) => b.tag === selectedOs.tag)) selectOs(builds[0]!);
  }, [builds, selectedOs, selectOs]);

  return (
    <div className="mt-6">
      <PickerHeader label="OS build" onRefresh={() => refresh(true)} />

      {err && <div className="text-[13px] text-body">Couldn't load builds: {err}</div>}
      {!err && builds === null && <div className="text-[13px] text-muted">Loading builds…</div>}
      {!err && builds?.length === 0 && <div className="text-[13px] text-muted">No OS builds found.</div>}

      {builds && builds.length > 0 && (
        <Select
          value={selectedOs?.tag ?? builds[0]!.tag}
          onChange={(e) => {
            const b = builds.find((x) => x.tag === e.target.value);
            if (b) selectOs(b);
          }}
        >
          {builds.map((b) => (
            <option key={b.tag} value={b.tag}>
              {optionLabel(b)}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
