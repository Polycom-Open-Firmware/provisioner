// A self-paced, step-through slideshow (e.g. disassembly photos). Manual prev/next
// + clickable progress dots + a counter. Driven by a step's `gallery` urls.
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Slideshow({
  images,
  captions,
  className,
}: {
  images: string[];
  captions?: string[];
  className?: string;
}) {
  const [i, setI] = React.useState(0);
  const n = images.length;
  if (n === 0) return null;
  // Clamp at the ends — no wrap-around.
  const go = (d: number) => setI((p) => Math.max(0, Math.min(n - 1, p + d)));
  const caption = captions?.[i];

  return (
    <div className={cn("flex select-none flex-col items-center", className)}>
      <div className="relative overflow-hidden rounded-[12px] border border-border">
        {/* Bound to the app window's content height (it tracks the window's own
            min(82vh,760px), minus chrome+copy) so the step fits without scrolling;
            the frame shrinks to the image, which keeps its own aspect ratio. */}
        <img
          src={images[i]}
          alt={`Step ${i + 1} of ${n}`}
          className="block max-h-[calc(min(82vh,760px)_-_360px)] max-w-[460px]"
        />
        {i > 0 && (
          <button
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-foreground shadow-soft transition hover:bg-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {i < n - 1 && (
          <button
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-foreground shadow-soft transition hover:bg-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {caption && <div className="mt-2 text-center font-mono text-[12px] text-muted">{caption}</div>}

      {n > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <div className="flex gap-1.5">
            {images.map((_, k) => (
              <button
                key={k}
                onClick={() => setI(k)}
                aria-label={`Go to photo ${k + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  k === i ? "w-5 bg-primary" : "w-1.5 bg-border hover:bg-muted",
                )}
              />
            ))}
          </div>
          <span className="font-mono text-[12px] text-muted">
            {i + 1} / {n}
          </span>
        </div>
      )}
    </div>
  );
}
