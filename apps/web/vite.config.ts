/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundled deps are served `Cache-Control: max-age=31536000, immutable`,
  // and their `?v=` hash is derived from the dependency set — so two worktrees
  // of this repo compute the SAME hash for DIFFERENT bundles. While two dev
  // stacks were both answering admin.racepace.lan (see docker-compose.yml),
  // browsers cached one stack's chunks under URLs the other also serves,
  // loading two copies of React ("Invalid hook call") and rendering a blank
  // page. `immutable` means a normal reload does not refetch, so that poisoned
  // cache outlived the routing fix.
  //
  // A distinct cacheDir gives this app its own optimize run — deps are still
  // SERVED from /node_modules/.vite/deps/ (Vite fixes that URL prefix), but
  // the re-optimization mints fresh `?v=` hashes, so the stale immutable
  // entries are no longer addressed and drop out of use on their own.
  cacheDir: "node_modules/.vite-racepace-admin",
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    host: true,                                    // listen on 0.0.0.0 (Docker)
    port: 5173,
    allowedHosts: ["admin.racepace.lan", "localhost"],
    hmr: { protocol: "wss", host: "admin.racepace.lan", clientPort: 443 }, // HMR over Traefik TLS
    watch: { usePolling: true },                   // macOS bind-mount fs events don't propagate
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
