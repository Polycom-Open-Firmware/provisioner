// SPDX-License-Identifier: GPL-2.0-or-later

import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldBase } from "./field";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** Styled text input — shares `fieldBase` with Select. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, className)} {...props} />
));
Input.displayName = "Input";

export { Input };
