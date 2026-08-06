import { defineConfig } from "@playwright/test";

// No `webServer` block on purpose: the admin runs in a long-lived Docker
// container on port 3001 behind Traefik at https://admin.racepace.lan (see
// docker-compose.yml's `web` service), and this repo's operational rule is
// never to start/stop/recreate containers from a task run. Spawning a second
// dev server here would race the container for port 3001 instead of using
// it, so E2E targets the container directly and expects it already up.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // The target is a single shared Next dev server (not a production build,
  // not one instance per worker) — see docker-compose.yml's `web` service.
  // Running the suite at the default worker count hammered it with enough
  // concurrent SSR requests to trigger a client-side exception on one run
  // (goBack() mid-navigation); serialising avoids contending with itself.
  workers: 1,
  retries: 1,
  use: {
    baseURL: "https://admin.racepace.lan",
    // Traefik's default cert is mkcert's local CA, which Chromium (unlike
    // curl -k / the host's trust store) does not trust automatically.
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
});
