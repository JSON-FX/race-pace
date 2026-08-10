import type { SupabaseClient } from "@supabase/supabase-js";
import { holdExpired } from "./holdExpiry";

/** The one live entry a runner may hold for an event, if they hold one.
 *  `expiresAt` is only meaningful while `status` is "pending". */
export type MyEntry = {
  id: string;
  status: "pending" | "paid";
  categoryId: string;
  expiresAt: string | null;
};

/** Mirrors the lazy check in registrations-checkout: a pending entry past its
 *  hold window is already gone to the runner, whether or not the 15-minute
 *  sweep has caught up. Showing "finish payment" for an entry the server will
 *  refuse is worse than showing nothing. */
export async function fetchMyEntry(
  db: SupabaseClient,
  eventId: string,
  userId: string | null,
): Promise<MyEntry | null> {
  if (!userId) return null;

  const { data } = await db
    .from("registrations")
    .select("id,status,category_id,expires_at")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .in("status", ["pending", "paid"])
    .maybeSingle();

  if (!data) return null;
  if (holdExpired(data.status, data.expires_at ?? null)) return null;

  return {
    id: data.id,
    status: data.status as "pending" | "paid",
    categoryId: data.category_id,
    expiresAt: data.expires_at ?? null,
  };
}
