import { createClient } from "@/lib/supabase/client";

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
 *  Route Handler with a code to exchange. `next` rides along so the runner
 *  lands back on the page they started from. */
export async function signInWithGoogle(next: string): Promise<{ error?: string }> {
  const supabase = createClient();
  const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback },
  });
  return error ? { error: error.message } : {};
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}
