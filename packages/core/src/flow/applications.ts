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
  /** The metapackage backing this application (poly-app-<id>); the archive's
   *  published version of it is what the tile's version badge shows. */
  pkg?: string;
  /** Boards this application runs on; absent = board-agnostic (all boards).
   *  Only applications that touch board-specific hardware set this. */
  boards?: string[];
  /** The app's own settings, shown when it is selected. */
  fields?: FormField[];
}

// --- shared applications (offered on more than one device) -------------------

export const APP_KIOSK: Application = {
  id: "kiosk",
  label: "Kiosk",
  description: "Locked fullscreen browser.",
  icon: "🖥️",
  pkg: "poly-app-kiosk",
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

/** Kodi media center as the kiosk's Wayland client. Board-agnostic: the C60
 *  image adds its portrait skin; the TC8 runs Kodi's default landscape skin.
 *  Two modes: the full Kodi UI, or a light "photo frame" that boots straight
 *  into a slideshow of the device's media. */
export const APP_MEDIA_PLAYER: Application = {
  id: "media-player",
  label: "Media player",
  description: "Kodi media center.",
  icon: "🎬",
  pkg: "poly-app-kodi",
  fields: [
    {
      key: "MEDIA_MODE",
      label: "Mode",
      options: [
        { value: "full", label: "Full media experience — the whole Kodi UI" },
        { value: "photoframe", label: "Digital photo frame — boots into a slideshow of your media" },
      ],
    },
    {
      key: "MEDIA_SOURCE",
      label: "Media server",
      placeholder: "smb://server/share (optional — local media always plays)",
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
  boards: ["c60"],
};

// --- the catalog -------------------------------------------------------------
// ONE master list; a device's menu is the board-agnostic apps plus the ones
// restricted to that board. Order = menu order; first entry = default.

export const APPLICATIONS: Application[] = [APP_KIOSK, APP_MEDIA_PLAYER, APP_SMART_SPEAKER, APP_NONE];

/** The applications offered on a device: everything not restricted to another
 *  board. */
export function applicationsFor(deviceId: string): Application[] {
  return APPLICATIONS.filter((a) => !a.boards || a.boards.includes(deviceId));
}

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
            pkg: a.pkg,
            fields: a.fields,
          })),
        },
      ],
    },
  };
}
