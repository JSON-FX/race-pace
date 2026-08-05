import { createClient } from "@/lib/supabase/client";
import { OAUTH_NEXT_COOKIE } from "@/lib/routes";

export async function signInWithPassword(email: string, password: string): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? { error: error.message } : {};
}

export async function signUpWithPassword(email: string, password: string): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signUp({ email: email.trim(), password });
  return error ? { error: error.message } : {};
}

/** OAuth round-trips through Supabase, which redirects back to our callback
 *  Route Handler with a code to exchange.
 *
 *  `redirectTo` MUST stay free of query parameters. Supabase matches it
 *  against the dashboard's Redirect URLs allow-list as a whole string, so
 *  `…/auth/callback?next=%2F` does NOT match a registered `…/auth/callback`.
 *  On a miss Supabase silently falls back to the project's Site URL, which
 *  dumped runners on `http://localhost:3000/?code=…` — a dead end in
 *  production. The destination therefore travels in a cookie instead, which
 *  also keeps the allow-list to one literal entry per host. */
export async function signInWithGoogle(next: string): Promise<{ error?: string }> {
  const supabase = createClient();
  // Read back in the callback Route Handler. SameSite=Lax is required and
  // sufficient: the return leg is a top-level GET navigation from Supabase to
  // our origin, which Lax permits (Strict would drop it, since the navigation
  // is cross-site initiated). 10 minutes is well over a Google consent screen
  // and short enough that a stale one can't misroute a later visit.
  document.cookie = `${OAUTH_NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=600; samesite=lax`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  return error ? { error: error.message } : {};
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}
