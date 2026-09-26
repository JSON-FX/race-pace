import { createClient } from "@/lib/supabase/server";

/** The RPC checks the caller's platform role before reading captured payments. */
export type SingleCaptureReview = {
  provider_payment_id: string;
  registration_id: string;
  event_name: string;
  org_name: string;
  amount_cents: number | null;
  reason: string | null;
  first_seen_at: string;
  registration_status: string;
  payment_status: string;
};

export async function listSingleCaptureReviews(): Promise<SingleCaptureReview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_single_capture_reviews");
  if (error) throw error;
  return (data ?? []) as SingleCaptureReview[];
}
