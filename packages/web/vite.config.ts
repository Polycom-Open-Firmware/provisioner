// SPDX-License-Identifier: GPL-2.0-or-later

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @provisioner/core is aliased to its TS source so Vite transpiles it as part of
// the app (the same swap point the native flavor will replace with a Tauri
// backend). "@/..." maps to this package's src, matching the shadcn convention.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@provisioner/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  server: { port: 5173 },
});
