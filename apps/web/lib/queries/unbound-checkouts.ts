import { createClient } from "@/lib/supabase/server";

/** Platform-only projection. The RPC checks auth_is_super_admin() before reading. */
export type UnboundCheckoutReview = {
  registration_id: string;
  event_id: string;
  event_name: string;
  org_id: string;
  org_name: string;
  amount_cents: number;
  expires_at: string | null;
  latest_outcome: string | null;
  attempts: number;
  last_attempt_at: string | null;
  capture_count: number;
};

export async function listUnboundCheckoutReviews(): Promise<UnboundCheckoutReview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_unbound_checkout_reviews");
  if (error) throw error;
  return (data ?? []) as UnboundCheckoutReview[];
}
