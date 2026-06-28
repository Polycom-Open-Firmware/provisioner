// A self-paced, step-through slideshow (e.g. disassembly photos). Manual prev/next
// + clickable progress dots + a counter. Driven by a step's `gallery` urls.
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Slideshow({ images, className }: { images: string[]; className?: string }) {
  const [i, setI] = React.useState(0);
  const n = images.length;
  if (n === 0) return null;
  const go = (d: number) => setI((p) => (p + d + n) % n);

  return (
    <div className={cn("select-none", className)}>
      <div className="relative overflow-hidden rounded-[12px] border border-border bg-rail">
        <img src={images[i]} alt={`Step ${i + 1} of ${n}`} className="aspect-[4/3] w-full object-cover" />
        {n > 1 && (
          <>
            <button
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-foreground shadow-soft transition hover:bg-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-foreground shadow-soft transition hover:bg-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

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
