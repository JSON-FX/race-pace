import { createClient } from "@/lib/supabase/server";

export type ReservationPaymentRow = {
  id: string;
  event_id: string;
  event_name: string;
  runner_name: string | null;
  runner_email: string;
  runner_avatar_url: string | null;
  paid_at: string | null;
  method: string | null;
  amount_cents: number;
  platform_fee_cents: number;
  processor_fee_cents: number;
  net_to_org_cents: number;
};

/** Reservation sales have their own ledger and never enter registration payment totals. */
export async function listReservationPayments(orgId: string, eventId?: string): Promise<ReservationPaymentRow[]> {
  const db = await createClient();
  let query = db.from("reservation_payments")
    .select("id,event_id,paid_at,method,amount_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents,events(name),event_reservations(user_id,email)")
    .eq("org_id", orgId).eq("status", "paid")
    .order("paid_at", { ascending: false }).limit(1001);
  if (eventId) query = query.eq("event_id", eventId);
  const { data, error } = await query;
  if (error || (data?.length ?? 0) > 1000) {
    throw new Error("Reservation payment report is unavailable or exceeds its safe page size.");
  }
  const userIds = [...new Set((data ?? []).map((payment) => {
    const reservation = payment.event_reservations as unknown as { user_id: string } | null;
    return reservation?.user_id;
  }).filter((id): id is string => !!id))];
  const profiles = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const { data: batch, error: profileError } = await db.from("profiles")
      .select("id,full_name,avatar_url").in("id", userIds.slice(offset, offset + 100));
    if (profileError) throw profileError;
    for (const profile of batch ?? []) profiles.set(profile.id, profile);
  }
  return (data ?? []).map((payment) => {
    const event = payment.events as unknown as { name: string } | null;
    const reservation = payment.event_reservations as unknown as { user_id: string; email: string } | null;
    const profile = reservation ? profiles.get(reservation.user_id) : null;
    if (payment.processor_fee_cents === null || payment.net_to_org_cents === null) {
      throw new Error("A paid reservation payment has incomplete fee records.");
    }
    return {
      id: payment.id, event_id: payment.event_id,
      runner_name: profile?.full_name ?? null, runner_avatar_url: profile?.avatar_url ?? null,
      event_name: event?.name ?? "Event", runner_email: reservation?.email ?? "Runner",
      paid_at: payment.paid_at, method: payment.method,
      amount_cents: payment.amount_cents, platform_fee_cents: payment.platform_fee_cents,
      processor_fee_cents: payment.processor_fee_cents, net_to_org_cents: payment.net_to_org_cents,
    };
  });
}
