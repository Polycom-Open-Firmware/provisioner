// SPDX-License-Identifier: GPL-2.0-or-later

// OsChooser — lists the available OS builds (tc8-firmware-build GitHub releases,
// plus the temporary local artifacts in local dev) and lets the operator pick
// one. Picking swaps the artifact source and advances.
import * as React from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { useWizard } from "@/lib/wizard";
import { listOsBuilds, type OsBuild } from "@/os-catalog";
import { Badge } from "@/components/ui/badge";

export function OsChooser() {
  const { selectOs, selectedOs } = useWizard();
  const [builds, setBuilds] = React.useState<OsBuild[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const refresh = React.useCallback(async (fresh = false) => {
    setBuilds(null);
    setErr(null);
    try {
      setBuilds(await listOsBuilds(fresh));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  // initial load uses the cached list; the refresh button forces a fresh pull
  React.useEffect(() => {
    void refresh(false);
  }, [refresh]);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          OS builds
        </div>
        <button
          onClick={() => refresh(true)}
          className="flex items-center gap-1 font-mono text-[11px] text-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>

      {err && <div className="text-[13px] text-body">Couldn't load builds: {err}</div>}
      {!err && builds === null && <div className="text-[13px] text-muted">Loading builds…</div>}
      {!err && builds?.length === 0 && <div className="text-[13px] text-muted">No OS builds found.</div>}

      <div className="flex flex-col gap-2">
        {builds?.map((b) => (
          <button
            key={b.tag}
            onClick={() => selectOs(b)}
            className={`flex items-center justify-between rounded-[8px] border bg-background px-4 py-3 text-left transition hover:border-primary ${
              selectedOs?.tag === b.tag ? "border-primary ring-1 ring-primary" : "border-border"
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-foreground">{b.name}</span>
                {b.prerelease && <Badge>Pre</Badge>}
                {b.local && <Badge>Dev</Badge>}
              </div>
              <div className="font-mono text-[12px] text-muted">{b.local ? "./artifacts" : b.tag}</div>
            </div>
            <HardDrive className="h-4 w-4 shrink-0 text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
