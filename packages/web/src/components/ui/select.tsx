// SPDX-License-Identifier: GPL-2.0-or-later

import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldBase } from "./field";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/** Styled native dropdown — shares `fieldBase` with Input. Extra right padding
 *  leaves room for the native chevron. */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(fieldBase, "cursor-pointer pr-8", className)} {...props} />
));
Select.displayName = "Select";

export { Select };
