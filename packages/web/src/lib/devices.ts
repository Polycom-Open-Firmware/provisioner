// SPDX-License-Identifier: GPL-2.0-or-later

// Device id -> bundled product image (web asset in public/). Kept in the UI, not
// core, since asset URLs are a web-only concern. `scale` can match differently-
// framed product shots to each other when needed.
export const DEVICE_IMAGES: Record<string, { src: string; scale?: string }> = {
  tc8: { src: "/poly-tc8.png" },
  c60: { src: "/poly-c60.png" },
};
