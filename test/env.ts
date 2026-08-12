import { config } from "dotenv";

config({ path: ".env.local" });

/** Local Supabase credentials, written by `supabase status -o env > .env.local`. */
export function loadEnv() {
  const url = process.env.API_URL ?? "http://127.0.0.1:54521";
  const anonKey = process.env.ANON_KEY;
  const serviceKey = process.env.SERVICE_ROLE_KEY;
  const dbUrl = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54522/postgres";
  // The project's HS256 signing secret. Only used to MINT tokens a real client
  // could never obtain (e.g. an `authenticated` role with no `sub`), so a
  // fail-closed guard can be proved fail-closed rather than assumed. The
  // fallback is the CLI's fixed local default, so a `.env.local` written before
  // this key was needed still works.
  const jwtSecret = process.env.JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
  if (!anonKey || !serviceKey) {
    throw new Error("Missing local keys. Run: pnpm exec supabase status -o env > .env.local");
  }
  return { url, anonKey, serviceKey, dbUrl, jwtSecret };
}
