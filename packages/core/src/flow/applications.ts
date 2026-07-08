// SPDX-License-Identifier: GPL-2.0-or-later

// applications.ts — the application catalog. An "application" is what a device
// is FOR (kiosk, smart speaker, … or nothing at all); picking one at install
// writes PROFILE=<id> into the config blob, and the device activates the
// matching baked role on first boot — no network needed.
//
// Applications are shared where the hardware allows (kiosk runs on both TC8
// and C60) and device-specific otherwise (smart speaker needs the C60 mic
// array). Each device profile exports its own list, so the menus overlap
// where it makes sense and diverge where the hardware does.
//
// Each application carries its OWN settings fields (kiosk → the kiosk URL…);
// the picker page renders the selected app's fields beneath the tiles, so
// configuring an app happens where you choose it.
import type { FormField } from "../engine/types";
import type { SettingsSection } from "./settings";

/** One selectable application. `id` is the PROFILE= value written to the blob. */
export interface Application {
  id: string;
  label: string;
  description: string;
  /** Tile glyph (emoji — renders everywhere, ships no asset). */
  icon: string;
  /** The app's own settings, shown when it is selected. */
  fields?: FormField[];
}

// --- shared applications (offered on more than one device) -------------------

export const APP_KIOSK: Application = {
  id: "kiosk",
  label: "Kiosk",
  description: "Locked fullscreen browser.",
  icon: "🖥️",
  fields: [
    { key: "KIOSK_URL", label: "Kiosk URL", placeholder: "https://dash.local" },
    { key: "KIOSK_URL_FALLBACK", label: "Fallback URL", placeholder: "shown if the kiosk URL is unreachable" },
    {
      key: "KIOSK_ENGINE",
      label: "Browser engine",
      options: [
        { value: "webkit", label: "WebKit (cog) — lightweight, the default" },
        { value: "chromium", label: "Chromium — full Chrome engine, heavier" },
      ],
    },
  ],
};

/** No application: the device boots to a console and nothing else runs.
 *  (Every unit already has developer access — ssh + root shell — so this
 *  replaces a separate "developer" app.) */
export const APP_NONE: Application = {
  id: "none",
  label: "No application",
  description: "Boots to a console.",
  icon: "＞_",
};

// --- C60-only applications (mic array + speaker) -----------------------------

export const APP_SMART_SPEAKER: Application = {
  id: "smart-speaker",
  label: "Smart speaker",
  description: "Voice assistant on the mic array.",
  icon: "🔊",
};

// --- per-device catalogs -----------------------------------------------------
// Order = menu order; the first entry is the default selection.

export const TC8_APPLICATIONS: Application[] = [APP_KIOSK, APP_NONE];

export const C60_APPLICATIONS: Application[] = [APP_KIOSK, APP_SMART_SPEAKER, APP_NONE];

// --- section builder ---------------------------------------------------------

/** Build the Application page for a device from its catalog: an icon-tile
 *  picker writing PROFILE, with the selected app's own fields underneath. */
export function applicationSection(apps: Application[]): SettingsSection {
  return {
    id: "application",
    rail: "Application",
    title: "Application",
    intro: "Choose what this device runs.",
    form: {
      fields: [
        {
          key: "PROFILE",
          label: "Application",
          options: apps.map((a) => ({
            value: a.id,
            label: a.label,
            description: a.description,
            icon: a.icon,
            fields: a.fields,
          })),
        },
      ],
      note:
        "Applications are baked into the image — first boot needs no network. " +
        "Left untouched, the first one is used.",
    },
  };
}
