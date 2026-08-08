import { config } from "dotenv";

config({ path: ".env.local" });

/** Local Supabase credentials, written by `supabase status -o env > .env.local`. */
export function loadEnv() {
  const url = process.env.API_URL ?? "http://127.0.0.1:54521";
  const anonKey = process.env.ANON_KEY;
  const serviceKey = process.env.SERVICE_ROLE_KEY;
  const dbUrl = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54522/postgres";
  if (!anonKey || !serviceKey) {
    throw new Error("Missing local keys. Run: pnpm exec supabase status -o env > .env.local");
  }
  return { url, anonKey, serviceKey, dbUrl };
}
