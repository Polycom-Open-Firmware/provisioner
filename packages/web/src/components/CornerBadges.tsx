// CornerBadges — stamps along the bottom of the device picker: a "use the native
// app" prompt on the left (web only — pointless inside the app), and "view source"
// + "support me" on the right. Tasteful pills; all open in a new tab.
import { Download } from "lucide-react";
import { isTauri } from "@/native/backend";

const GITHUB_URL = "https://github.com/Polycom-Open-Firmware";
const RELEASES_URL = "https://github.com/Polycom-Open-Firmware/provisioner/releases";
const KOFI_URL = "https://ko-fi.com/retrogrademarmalade";

const PILL =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-2.5 py-1 text-[11px] text-muted backdrop-blur transition hover:border-primary hover:text-foreground";

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

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

export function CornerBadges() {
  return (
    <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between">
      {/* left slot — empty in the native app so the right pills stay put */}
      <div>
        {!isTauri() && (
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Download the desktop app"
            className={PILL}
          >
            <Download className="h-3.5 w-3.5" />
            <span>Use the native app</span>
          </a>
        )}
      </div>

      <div className="flex items-center gap-2">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" title="View source on GitHub" className={PILL}>
          <GithubMark className="h-3.5 w-3.5" />
          <span>View source code</span>
        </a>
        <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" title="Support on Ko-fi" className={PILL}>
          <KofiCup className="h-3.5 w-3.5" />
          <span>Help me fund the purchase of more ewaste</span>
        </a>
      </div>
    </div>
  );
}
