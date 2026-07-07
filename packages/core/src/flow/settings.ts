// SPDX-License-Identifier: GPL-2.0-or-later

// settings.ts — the three settings sub-steps (Device / Network / Access) shared
// by the Configure flow and the install flows' Setup block. Each is a plain
// confirm step; the web UI renders the matching ConfigForm section for the
// `settings-*` ids. Splitting the old single 9-field page keeps every step
// inside the wizard window (no scrolling).
import type { Step } from "../engine/types";

/** Tailors the when-applied sentence: Setup writes values applied on first
 *  boot; Configure pushes changes an installed device applies on next boot. */
export type SettingsIntent = "first-boot" | "reconfigure";

export function settingsSteps(group: string, intent: SettingsIntent): Step[] {
  const when =
    intent === "first-boot"
      ? "Values are applied on first boot; anything left blank keeps its default."
      : "The device applies changes on its next boot; anything left blank is kept as-is.";
  return [
    {
      id: "settings-device",
      type: "confirm",
      rail: "Device",
      group,
      title: "Device settings",
      body: "Name the device and point it at its kiosk. " + when,
      confirmLabel: "Continue",
    },
    {
      id: "settings-network",
      type: "confirm",
      rail: "Network",
      group,
      title: "Network settings",
      body: "Set the Wi-Fi network the device should join. " + when,
      confirmLabel: "Continue",
    },
    {
      id: "settings-access",
      type: "confirm",
      rail: "Access",
      group,
      title: "Access settings",
      body: "Set how you'll log into the device. " + when,
      confirmLabel: "Continue",
    },
  ];
}
