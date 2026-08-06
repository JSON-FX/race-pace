import { createBrowserClient } from "@supabase/ssr";

/** Browser-side client. Reads the session from cookies written by middleware,
 *  so it stays in sync with what server components see. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
