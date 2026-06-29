// SPDX-License-Identifier: GPL-2.0-or-later

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        backdrop: "var(--backdrop)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        body: "var(--body)",
        muted: "var(--muted)",
        border: "var(--border)",
        rail: "var(--rail)",
        primary: {
          DEFAULT: "var(--primary)",
          hover: "var(--primary-hover)",
          tint: "var(--primary-tint)",
          tint2: "var(--primary-tint-2)",
          foreground: "var(--primary-foreground)",
        },
        console: {
          DEFAULT: "var(--console-bg)",
          fg: "var(--console-fg)",
          ts: "var(--console-ts)",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: { lg: "0.625rem", xl: "0.875rem" },
      boxShadow: {
        window: "0 24px 60px -12px rgba(28,26,23,0.35), 0 8px 24px -8px rgba(28,26,23,0.20)",
        soft: "0 1px 2px rgba(28,26,23,0.04), 0 6px 18px -10px rgba(28,26,23,0.14)",
      },
    },
  },
  plugins: [],
};
