// SPDX-License-Identifier: GPL-2.0-or-later

// applications.ts — the application catalog. An "application" is what a device
// is FOR (kiosk, smart speaker, …); picking one at install writes PROFILE=<id>
// into the config blob, and the device activates the matching baked profile
// package (poly-<device>-profile-<id>) on first boot — no network needed.
//
// Applications are shared where the hardware allows (kiosk runs on both TC8 and
// C60) and device-specific otherwise (smart speaker needs the C60 mic array).
// Each device profile exports its own list (TC8_APPLICATIONS / C60_APPLICATIONS)
// composed from these shared constants plus its own — so the two menus overlap
// where it makes sense and diverge where the hardware does.
import type { SettingsSection } from "./settings";

/** One selectable application. `id` is the PROFILE= value written to the blob
 *  and the poly-<device>-profile-<id> package the device activates. */
export interface Application {
  id: string;
  label: string;
  description: string;
}

// --- shared applications (offered on more than one device) -------------------

export const APP_KIOSK: Application = {
  id: "kiosk",
  label: "Kiosk",
  description: "Locked full-screen web kiosk pointed at the Kiosk URL.",
};

export const APP_DEV: Application = {
  id: "dev",
  label: "Developer",
  description: "Unlocked shell with SSH — for development and bring-up units.",
};

// --- C60-only applications (mic array + speaker + display) -------------------

export const APP_SMART_SPEAKER: Application = {
  id: "smart-speaker",
  label: "Smart speaker",
  description: "Voice-assistant appliance using the C60 mic array and speaker.",
};

// --- per-device catalogs -----------------------------------------------------
// Order = menu order; the first entry is the default selection.

export const TC8_APPLICATIONS: Application[] = [APP_KIOSK, APP_DEV];

export const C60_APPLICATIONS: Application[] = [APP_KIOSK, APP_SMART_SPEAKER, APP_DEV];

// --- section builder ---------------------------------------------------------

/** Build the Application settings page for a device from its catalog. The picker
 *  writes the chosen id to PROFILE (first option is the default, seeded by the
 *  form so it's always written). One section per device — the menus differ. */
export function applicationSection(apps: Application[]): SettingsSection {
  return {
    id: "application",
    rail: "Application",
    title: "Application",
    intro: "Choose what this device runs — its application decides what starts at boot.",
    form: {
      fields: [
        {
          key: "PROFILE",
          label: "Application",
          options: apps.map((a) => ({ value: a.id, label: `${a.label} — ${a.description}` })),
        },
      ],
      note:
        "The device installs the matching application on first boot — the packages are " +
        "baked into the image, so no network is needed. Left unset, it defaults to the first.",
    },
  };
}
