// KofiBadge — a small, tasteful "support me" stamp for the device-picker corner.
const KOFI_URL = "https://ko-fi.com/retrogrademarmalade";

function KofiCup({ className }: { className?: string }) {
  // Ko-fi-style cup: coral cup + handle with a little white heart.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="2.5" y="6" width="13" height="13" rx="3.5" fill="#FF5E5B" />
      <path d="M15.5 8.8h2.2a3.4 3.4 0 0 1 0 6.8h-2.2" fill="none" stroke="#FF5E5B" strokeWidth="2.1" />
      <path
        d="M9 16C6 13.9 4.4 12.5 4.4 10.8c0-1.2.9-2 2-2 .8 0 1.5.4 2.6 1.5 1.1-1.1 1.8-1.5 2.6-1.5 1.1 0 2 .8 2 2 0 1.7-1.6 3.1-4.6 5.2Z"
        fill="#fff"
      />
    </svg>
  );
}

export function KofiBadge() {
  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Support on Ko-fi"
      className="absolute bottom-5 right-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-2.5 py-1 text-[11px] text-muted backdrop-blur transition hover:border-primary hover:text-foreground"
    >
      <KofiCup className="h-3.5 w-3.5" />
      <span>Help me fund the purchase of more ewaste</span>
    </a>
  );
}
