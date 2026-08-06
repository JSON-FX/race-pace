import type { SupabaseClient } from "@supabase/supabase-js";
import { isRegistrationClosed } from "./eventStatus";

export type SeasonStats = {
  /** Events a runner can still enter. */
  racesOpen: number;
  /** Distinct organizers running those events. */
  organizers: number;
  /** Longest distance on offer, in km. Null when nothing is capped/measured. */
  longestKm: number | null;
};

/**
 * Headline numbers for the sign-in canvas.
 *
 * Real data, not decoration: "20 races open" is the reason to make an account,
 * and a hardcoded number would be a lie the moment a season ends — the worst
 * kind, because nobody would notice it had gone stale.
 *
 * "Open" uses `isRegistrationClosed`, the SAME rule the catalog and the mobile
 * app apply, so the count here can never disagree with the list a runner sees
 * one tap later. Counting every row instead would include cancelled and
 * completed races and overstate what is actually enterable.
 *
 * Fails soft. This is decoration on an auth page: if the query errors the form
 * must still render, so the caller gets zeroes and the strip hides itself
 * rather than blocking sign-in behind a stats read.
 */
export async function fetchSeasonStats(db: SupabaseClient): Promise<SeasonStats> {
  try {
    const [eventsRes, catsRes] = await Promise.all([
      db.from("events").select("id,status,org_id"),
      // distance_km lives on categories, not events — an event's "longest" is
      // the longest distance any of its categories offers.
      db.from("categories").select("event_id,distance_km"),
    ]);

    if (eventsRes.error || catsRes.error) {
      return { racesOpen: 0, organizers: 0, longestKm: null };
    }

    const open = (eventsRes.data ?? []).filter(
      (e) => !isRegistrationClosed(String(e.status)),
    );
    const openIds = new Set(open.map((e) => e.id as string));

    const distances = (catsRes.data ?? [])
      .filter((c) => openIds.has(c.event_id as string))
      .map((c) => Number(c.distance_km))
      .filter((n) => Number.isFinite(n) && n > 0);

    return {
      racesOpen: open.length,
      organizers: new Set(open.map((e) => e.org_id as string)).size,
      longestKm: distances.length ? Math.max(...distances) : null,
    };
  } catch {
    return { racesOpen: 0, organizers: 0, longestKm: null };
  }
}
