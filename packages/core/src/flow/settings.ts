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

/** Which settings pages a device gets — e.g. the TC8 is PoE/ethernet-only, so
 *  it drops "network" (the Wi-Fi page). Order here is the step order. */
export type SettingsSection = "device" | "network" | "access";

const ALL_SECTIONS: SettingsSection[] = ["device", "network", "access"];

export function settingsSteps(
  group: string,
  intent: SettingsIntent,
  sections: SettingsSection[] = ALL_SECTIONS,
): Step[] {
  const when =
    intent === "first-boot"
      ? "Values are applied on first boot; anything left blank keeps its default."
      : "The device applies changes on its next boot; anything left blank is kept as-is.";
  const all: Record<SettingsSection, Step> = {
    device: {
      id: "settings-device",
      type: "confirm",
      rail: "Device",
      group,
      title: "Device settings",
      body: "Name the device and point it at its kiosk. " + when,
      confirmLabel: "Continue",
    },
    network: {
      id: "settings-network",
      type: "confirm",
      rail: "Network",
      group,
      title: "Network settings",
      body: "Set the Wi-Fi network the device should join. " + when,
      confirmLabel: "Continue",
    },
    access: {
      id: "settings-access",
      type: "confirm",
      rail: "Access",
      group,
      title: "Access settings",
      body: "Set how you'll log into the device. " + when,
      confirmLabel: "Continue",
    },
  };
  return sections.map((s) => all[s]);
}
