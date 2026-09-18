import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server client for Server Components, Server Actions and Route Handlers.
 *  `cookies()` is async in Next 15 — this function must be awaited.
 *
 *  SUPABASE_INTERNAL_URL exists for containerised dev. Server components fetch
 *  from inside the container, where the browser-facing 127.0.0.1 points at the
 *  container itself; the browser meanwhile cannot resolve a Docker service
 *  name. Since NEXT_PUBLIC_SUPABASE_URL is read by BOTH, the two needs can only
 *  be met by letting the server override it. Unset in every other environment,
 *  where the public URL is correct for both. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // The internal Docker hostname changes Supabase's default cookie name.
      // Match the browser endpoint so server-side auth reads the same session.
      cookieOptions: {
        name: `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`,
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies. Middleware refreshes the
            // session on every request, so this is safe to swallow.
          }
        },
      },
    },
  );
}
