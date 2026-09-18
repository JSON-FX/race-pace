import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side Supabase client for Server Components and Route Handlers.
 *  `cookies()` is async in Next 15 — this function must be awaited. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    // Server-side: prefer the container-internal URL when set (dev Docker).
    // Mirrors apps/web; unset outside containerised dev.
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
