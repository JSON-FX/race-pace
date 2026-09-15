import { createBrowserClient } from "@supabase/ssr";

/** Explicit redemption keeps an old browser session from masquerading as a valid reset link. */
export function createRecoveryClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { isSingleton: false, auth: { detectSessionInUrl: false, autoRefreshToken: false } },
  );
}

export async function redeemRecoveryLink(url: URL) {
  const client = createRecoveryClient();
  const hash = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.has("error") || hash.has("error")) return null;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    // The runtime returns redirectType, but AuthTokenResponse omits it.
    if (error || !("redirectType" in data) || data.redirectType !== "recovery") return null;
  } else if (tokenHash && url.searchParams.get("type") === "recovery") {
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    if (error) return null;
  } else if (hash.get("type") === "recovery" && hash.get("access_token") && hash.get("refresh_token")) {
    const { error } = await client.auth.setSession({
      access_token: hash.get("access_token")!, refresh_token: hash.get("refresh_token")!,
    });
    if (error) return null;
  } else return null;
  const { data: { user }, error } = await client.auth.getUser();
  return !error && user ? { client, userId: user.id } : null;
}
