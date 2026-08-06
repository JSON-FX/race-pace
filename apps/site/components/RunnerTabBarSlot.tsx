import { createClient } from "@/lib/supabase/server";
import { RunnerTabBar } from "@/components/RunnerTabBar";

/**
 * Answers "is anyone signed in?" for the mobile tab bar, the same way
 * SiteHeader does for the nav.
 *
 * A separate slot rather than a prop threaded through the layout: the tab bar
 * renders at the END of the body (after the footer) so it is the last thing in
 * the document, while the header renders at the top. They cannot share one
 * component, but they must agree on auth — so both read it the same way, with
 * `getUser()` and never `getSession()`, since getSession() returns unverified
 * cookie contents and a forged cookie would flip the bar to its signed-in state.
 *
 * Rendered in the root layout, not per page: six routes had silently shipped
 * without the footer for exactly this reason, and navigation is worse to miss.
 */
export async function RunnerTabBarSlot() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  return <RunnerTabBar signedIn={!!user} />;
}
