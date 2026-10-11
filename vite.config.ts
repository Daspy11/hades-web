import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The source tree under src/ mirrors the original Haskell repository layout
// (banana-ui/, hades/, dsm/), with src/lib/ holding TypeScript replacements for the
// Haskell libraries the original depended on (containers, lens, aeson, reactive-banana,
// cairo, pango, gtk, ...).
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"], setupFiles: ["src/testSetup.ts"] },
} as any);
