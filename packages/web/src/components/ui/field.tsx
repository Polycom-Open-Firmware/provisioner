// SPDX-License-Identifier: GPL-2.0-or-later

// Shared styling for form controls (Input, Select). This is the single source of
// truth for how a text field / dropdown looks — restyle here and every field and
// dropdown across the app follows.
export const fieldBase =
  "w-full rounded-[8px] border border-border bg-background px-3 py-2.5 text-[14px] text-foreground " +
  "placeholder:text-muted outline-none transition-colors focus:border-primary focus:ring-1 " +
  "focus:ring-primary disabled:opacity-55 disabled:pointer-events-none";
