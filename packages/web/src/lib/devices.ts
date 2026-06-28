// Device id -> bundled product image (web asset in public/). Kept in the UI, not
// core, since asset URLs are a web-only concern. `scale` matches differently-framed
// product shots to each other (TC8's is tighter, so shrink it to ~match the C60).
export const DEVICE_IMAGES: Record<string, { src: string; scale?: string }> = {
  tc8: { src: "/poly-tc8.png", scale: "scale-[0.8]" },
};
