// SPDX-License-Identifier: GPL-2.0-or-later

// settings.ts — the device-settings pages as DATA. A SettingsSection bundles a
// rail label, intro copy, and a form schema (fields → config-contract keys); a
// device profile picks the sections it has (or defines its own), and
// settingsSteps() turns them into grouped confirm steps the UI renders
// generically. Adding a device — or a device-specific page — never touches the
// web package. One section per page keeps every step inside the wizard window.
import type { Step, StepForm } from "../engine/types";

/** Tailors the when-applied sentence: Setup writes values applied on first
 *  boot; Configure pushes changes an installed device applies on next boot. */
export type SettingsIntent = "first-boot" | "reconfigure";

/** One settings page: a rail label, intro copy, and its form schema. */
export interface SettingsSection {
  /** Step id suffix — the step becomes `settings-<id>`. */
  id: string;
  /** Sub-step label in the rail. */
  rail: string;
  title: string;
  /** Lead sentence; the intent's when-applied sentence is appended. */
  intro: string;
  form: StepForm;
}

// --- the standard sections (keys: poly-firmware-build/CONFIG-PARTITION.md) -----
// The Application page (the device-role picker) is per-device — built from each
// device's catalog by applicationSection() in ./applications.ts.

export const DEVICE_SETTINGS: SettingsSection = {
  id: "device",
  rail: "Device",
  title: "Device settings",
  intro: "Name the device and point it at its kiosk.",
  form: {
    fields: [
      { key: "DEVICE_NAME", label: "Device name", placeholder: "lobby-east" },
      { key: "KIOSK_URL", label: "Kiosk URL", placeholder: "https://dash.local" },
      { key: "TIMEZONE", label: "Time zone", placeholder: "America/New_York" },
      { key: "NTP_SERVER", label: "NTP server", placeholder: "192.168.1.1" },
    ],
  },
};

export const NETWORK_SETTINGS: SettingsSection = {
  id: "network",
  rail: "Network",
  title: "Network settings",
  intro: "Set the Wi-Fi network the device should join.",
  form: {
    fields: [
      { key: "WIFI_SSID", label: "Wi-Fi SSID", placeholder: "Corp-Guest" },
      {
        key: "WIFI_PASSWORD",
        label: "Wi-Fi password",
        placeholder: "leave blank for open Wi-Fi or to keep current",
        secret: true,
      },
      { key: "WIFI_COUNTRY", label: "Wi-Fi country", placeholder: "US" },
    ],
  },
};

export const ACCESS_SETTINGS: SettingsSection = {
  id: "access",
  rail: "Access",
  title: "Access settings",
  intro: "Set how you'll log into the device.",
  form: {
    fields: [
      {
        key: "ROOT_PASSWORD",
        label: "Root password",
        placeholder: "leave blank to keep current",
        secret: true,
      },
      { key: "SSH_AUTHKEY", label: "SSH public key", placeholder: "ssh-ed25519 AAAA…" },
    ],
    note:
      "Fields left blank stay as they are on the device. Values are stored in plain text on " +
      "the device — see CONFIG-PARTITION.md.",
  },
};

export const STANDARD_SETTINGS: SettingsSection[] = [
  DEVICE_SETTINGS,
  NETWORK_SETTINGS,
  ACCESS_SETTINGS,
];

/** Turn settings sections into grouped confirm steps. `group` is the tier-1
 *  rail label; `sections` are the pages the device actually has. */
export function settingsSteps(
  group: string,
  intent: SettingsIntent,
  sections: SettingsSection[] = STANDARD_SETTINGS,
): Step[] {
  const when =
    intent === "first-boot"
      ? "Values are applied on first boot; anything left blank keeps its default."
      : "The device applies changes on its next boot; anything left blank is kept as-is.";
  return sections.map((s) => ({
    id: `settings-${s.id}`,
    type: "confirm" as const,
    rail: s.rail,
    group,
    title: s.title,
    body: s.intro + " " + when,
    confirmLabel: "Continue",
    form: s.form,
  }));
}
