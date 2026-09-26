import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReservationCallback({ searchParams }: {
  searchParams: Promise<{ reservation_id?: string; status?: string }>;
}) {
  const { reservation_id: id, status } = await searchParams;
  if (!id || !UUID.test(id)) redirect("/events");
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/reservations/${id}`)}`);
  redirect(`/reservations/${id}${status === "paid" ? "?returned=1" : ""}`);
}
