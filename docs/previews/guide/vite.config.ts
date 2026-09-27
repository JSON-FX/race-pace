import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": "/Users/jsonse/Documents/development/storybook-hub/projects/race-pace/src" } },
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 4178, strictPort: true },
});
