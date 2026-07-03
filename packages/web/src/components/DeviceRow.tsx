// SPDX-License-Identifier: GPL-2.0-or-later

// DeviceRow — a selectable row (title + subtitle + trailing icon) for the native
// serial/USB device lists.
import * as React from "react";

export function DeviceRow({
  title,
  subtitle,
  icon,
  onClick,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-[8px] border border-border bg-background px-4 py-3 text-left transition hover:border-primary"
    >
      <div>
        <div className="text-[15px] font-semibold text-foreground">{title}</div>
        {subtitle && <div className="text-[12px] text-muted">{subtitle}</div>}
      </div>
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
    </button>
  );
}
