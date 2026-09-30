import { createClient } from "@/lib/supabase/server";

type Place = {
  id: string; category_id: string | null; participant_name: string; is_managed: boolean; status: string;
  entry_payment_deadline_at: string | null;
  categories: { label: string; code: string | null; entry_payment_deadline_at: string | null } | null;
};
type Payment = { status: string; amount_cents: number; paid_at: string | null };
type Header = {
  id: string; user_id: string; email: string; status: string; paid_at: string | null;
  registration_deadline_at: string | null; checkout_expires_at: string | null; created_at: string;
  event_reservation_places: Place[]; reservation_payments: Payment | Payment[] | null;
};
export type ReservationRow = {
  id: string; userId: string; name: string; email: string; avatarUrl: string | null;
  paymentStatus: string; paidAt: string | null; amountCents: number | null;
  converted: boolean; managed: { name: string; category: string; status: string }[];
  categories: string[]; categoryIds: string[]; deadlines: { category: string; at: string | null }[];
};
export type ReservationSummary = { total: number; paid: number; paidAmountCents: number; pending: number };
export type ReservationCategoryAvailability = {
  id: string; code: string | null; label: string; capacity: number; reservationEnabled: boolean;
  totalAvailable: number | null; generalAvailable: number | null; reservationAvailable: number | null;
};

/** Use the capacity ledger so held places and converted entries count once. */
export async function getReservationCategoryAvailability(orgId: string, eventId: string): Promise<ReservationCategoryAvailability[]> {
  const db = await createClient();
  const [categories, availability] = await Promise.all([
    db.from("categories").select("id,code,label,slots_total,reservation_enabled")
      .eq("org_id", orgId).eq("event_id", eventId)
      .order("distance_km", { ascending: false, nullsFirst: false }).order("id"),
    db.rpc("category_availability", { p_event: eventId }),
  ]);
  if (categories.error) throw categories.error;
  if (availability.error) throw availability.error;
  const slots = availability.data as { category_id: string; total_available: number; general_available: number; reservation_available: number }[] | null;
  const byCategory = new Map((slots ?? []).map(row => [row.category_id, row]));
  return (categories.data ?? []).map(category => {
    const slots = byCategory.get(category.id);
    return {
      id: category.id, code: category.code, label: category.label, capacity: category.slots_total,
      reservationEnabled: category.reservation_enabled,
      totalAvailable: slots?.total_available ?? null, generalAvailable: slots?.general_available ?? null,
      reservationAvailable: slots?.reservation_available ?? null,
    };
  });
}

function personalName(value: string | null | undefined) {
  const name = value?.trim();
  return name && !["My Race Passport", "Managed Race Passport", "My Passport"].includes(name) ? name : null;
}
function latestDeadline(place: Place, fallback: string | null) {
  const deadlines = [place.entry_payment_deadline_at, place.categories?.entry_payment_deadline_at]
    .filter((value): value is string => !!value);
  return deadlines.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? fallback;
}

export async function listReservationEvents(orgId: string) {
  const db = await createClient();
  const events: { id: string; name: string; event_date: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("events").select("id,name,event_date")
      .eq("org_id", orgId).order("event_date", { ascending: false }).order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    events.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return events;
}

/** The complete event set keeps filtering and checkout totals independent.
 * Bounded reads avoid PostgREST's default row limit and profile URL limits.
 * Groups stay on their header: a paid amount must never be multiplied by places. */
export async function getEventReservations(orgId: string, eventId: string): Promise<{
  rows: ReservationRow[]; summary: ReservationSummary;
}> {
  const db = await createClient();
  const headers: Header[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.from("event_reservations")
      .select("id,user_id,email,status,paid_at,registration_deadline_at,checkout_expires_at,created_at,event_reservation_places(id,category_id,participant_name,is_managed,status,entry_payment_deadline_at,categories(label,code,entry_payment_deadline_at)),reservation_payments(status,amount_cents,paid_at)")
      .eq("org_id", orgId).eq("event_id", eventId)
      .order("created_at", { ascending: false }).order("id").range(offset, offset + 99)
      .returns<Header[]>();
    if (error) throw error;
    headers.push(...(data ?? []));
    if ((data?.length ?? 0) < 100) break;
  }
  const userIds = [...new Set(headers.map(header => header.user_id))];
  const profiles = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const { data, error } = await db.from("profiles").select("id,full_name,avatar_url")
      .in("id", userIds.slice(offset, offset + 100));
    if (error) throw error;
    for (const profile of data ?? []) profiles.set(profile.id, profile);
  }
  const summary: ReservationSummary = { total: headers.length, paid: 0, paidAmountCents: 0, pending: 0 };
  const now = Date.now();
  const rows = headers.map(header => {
    const payment = Array.isArray(header.reservation_payments) ? header.reservation_payments[0] : header.reservation_payments;
    const paid = payment?.status === "paid";
    const reviewRequired = payment?.status === "review_required" || header.status === "review_required";
    const windowEnded = !!header.checkout_expires_at && new Date(header.checkout_expires_at).getTime() <= now;
    const awaitingPayment = header.status === "pending" && !paid && !reviewRequired && !windowEnded;
    if (paid) { summary.paid++; summary.paidAmountCents += payment.amount_cents; }
    if (awaitingPayment) summary.pending++;
    const profile = profiles.get(header.user_id);
    const places = header.event_reservation_places ?? [];
    const name = personalName(profile?.full_name) ?? personalName(places.find(place => !place.is_managed)?.participant_name) ?? header.email;
    const category = (place: Place) => place.categories?.code?.trim() || place.categories?.label || "Category unavailable";
    const deadlines = places.length ? places.map(place => ({ category: category(place), at: latestDeadline(place, header.registration_deadline_at) }))
      : [{ category: "Category unavailable", at: header.registration_deadline_at }];
    return {
      id: header.id, userId: header.user_id, name, email: header.email, avatarUrl: profile?.avatar_url ?? null,
      paymentStatus: paid ? "Paid" : reviewRequired ? "Review required" : header.status === "pending" && windowEnded ? "Payment window ended" : awaitingPayment ? (payment?.status === "failed" ? "Failed" : "Pending")
        : header.status === "paid" || header.status === "converted" ? "Payment unavailable" : header.status.replaceAll("_", " "),
      paidAt: payment?.paid_at ?? header.paid_at, amountCents: paid ? payment.amount_cents : null,
      converted: header.status === "converted" || places.some(place => place.status === "converted"),
      managed: places.filter(place => place.is_managed).map(place => ({ name: place.participant_name, category: category(place), status: place.status })),
      categories: [...new Set(places.map(category))],
      categoryIds: [...new Set(places.map(place => place.category_id).filter((id): id is string => !!id))],
      deadlines: deadlines.filter((deadline, index) => deadlines.findIndex(value => value.category === deadline.category && value.at === deadline.at) === index),
    };
  });
  return { rows, summary };
}
