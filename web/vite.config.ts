import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The page is built into one HTML file with its script, style and font inline, so the
// dashboard server and a saved snapshot need nothing else and fetch nothing from the network.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile({ removeViteModuleLoader: true })],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "../src/report/web", emptyOutDir: true, assetsInlineLimit: 1_000_000, reportCompressedSize: false },
});
