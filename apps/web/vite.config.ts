/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
