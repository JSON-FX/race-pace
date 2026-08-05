import { config } from "dotenv";

// Hosted is the only backend now. .env.local (local-stack output from
// `supabase status -o env`) is still read as a fallback so an older checkout
// keeps working, but .env.hosted wins when both are present.
config({ path: ".env.hosted" });
config({ path: ".env.local" });

/** Hosted Supabase credentials for the database test suites (project whaqarofxdlzxrelbcrq). */
export function loadEnv() {
  const url = process.env.API_URL;
  const anonKey = process.env.ANON_KEY;
  const serviceKey = process.env.SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Missing Supabase keys. Create .env.hosted with API_URL / ANON_KEY / SERVICE_ROLE_KEY:\n" +
        "  pnpm exec supabase projects api-keys --project-ref whaqarofxdlzxrelbcrq",
    );
  }
  return { url, anonKey, serviceKey };
}
