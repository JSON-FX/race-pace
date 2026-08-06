import { z } from "zod";
import { EVENT_DISCIPLINES, isValidRoute, type RoutePoint } from "@race-pace/shared";

// 'cancelled' is set via the Cancel modal, not the editor status field.
export const EVENT_STATUSES = ["draft", "open", "almost_full", "closed", "completed"] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable();
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM").nullable();
const scheduleTimeStr = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
const intNonNeg = z.number().int().min(0);

/** One race-morning timeline row. Both fields required — a fully blank row
 *  isn't a meaningful entry, so it's dropped from the array by
 *  sanitizeListFields() before validation/save rather than persisted as a
 *  partial row or blocking Save with a "fix the fields" error. */
export const scheduleItemSchema = z.object({
  time: scheduleTimeStr,
  label: z.string().trim().min(1, "Label required"),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

// One bullet in the "what's included" list on the public page — short prose,
// roughly one line ("Six aid stations with hot food").
export const INCLUSION_MAX_LEN = 140;

/** One inclusion line. A blank row is dropped by sanitizeListFields() before
 *  validation/save, same as a blank schedule row, rather than persisted as an
 *  empty bullet or persisted with incidental whitespace. */
export const inclusionItemSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(INCLUSION_MAX_LEN, `Keep each line under ${INCLUSION_MAX_LEN} characters`);

export const eventInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  city_psgc_code: z.string().nullable(),
  region_name: z.string().nullable(),
  province_name: z.string().nullable(),
  city_name: z.string().nullable(),
  venue: z.string().nullable(),
  event_date: dateStr,
  end_date: dateStr,
  flag_off: timeStr,
  status: z.enum(EVENT_STATUSES),
  discipline: z.enum(EVENT_DISCIPLINES),
  elevation_gain_m: intNonNeg.nullable(),
  cutoff_hours: intNonNeg.nullable(),
  // Course locator. Ranges mirror the DB check constraints so a transposed
  // lat/lng pair (a common paste error) is caught in the form rather than
  // by a 400 from Postgres after Save.
  start_lat: z.number().min(-90, "-90 to 90").max(90, "-90 to 90").nullable().default(null),
  start_lng: z.number().min(-180, "-180 to 180").max(180, "-180 to 180").nullable().default(null),
  finish_lat: z.number().min(-90, "-90 to 90").max(90, "-90 to 90").nullable().default(null),
  finish_lng: z.number().min(-180, "-180 to 180").max(180, "-180 to 180").nullable().default(null),
  // Route points are validated structurally by isValidRoute (shared) rather
  // than re-described here: one definition, used by the importer, the form
  // and the public map alike.
  route: z.custom<RoutePoint[] | null>((v) => v === null || isValidRoute(v), "Invalid course route").nullable().default(null),
  description: z.string().nullable(),
  hero_image_url: z.string().nullable(),
  gallery: z.array(z.string()).default([]),
  schedule: z.array(scheduleItemSchema).default([]),
  inclusions: z.array(inclusionItemSchema).default([]),
});

/**
 * Mirrors events_start_coords_paired / events_finish_coords_paired
 * (supabase/migrations/20260806160000_event_course_coordinates.sql:
 * `check ((start_lat is null) = (start_lng is null))`, same for finish).
 * Kept as a standalone function rather than a `.refine()` chained onto
 * eventInputSchema: both call sites (event-editor-form.tsx and
 * lib/actions/events.ts) need `eventInputSchema.omit({ status: true })`,
 * and `.refine()`/`.superRefine()` return a ZodEffects, which drops
 * `.omit()`. Without this check, an organizer who types a start latitude
 * and tabs away before the longitude passes per-field client validation
 * (each field is valid on its own), Save re-validates the same way and also
 * passes, and only Postgres's CHECK constraint catches it — which
 * saveEventAction then collapses to the generic "Something went wrong" with
 * no indication of which field, and no way to fix it from the message
 * alone.
 */
export function coordPairError(e: { start_lat: number | null; start_lng: number | null; finish_lat: number | null; finish_lng: number | null }): string | null {
  if ((e.start_lat === null) !== (e.start_lng === null)) return "Enter both start latitude and longitude, or leave both blank.";
  if ((e.finish_lat === null) !== (e.finish_lng === null)) return "Enter both finish latitude and longitude, or leave both blank.";
  return null;
}

/** Drops blank rows from the two ordered list fields (schedule, inclusions)
 *  and trims their text, ahead of both validation and save. A row an
 *  organizer leaves empty is removed rather than either blocking Save with a
 *  partial-row error or reaching the database as '' / a hollow schedule
 *  entry. Call this on the draft right before eventInputSchema.safeParse and
 *  right before saveEvent — never mutate component state with it, so a
 *  half-typed row doesn't vanish from the screen while the organizer is
 *  still filling it in. */
export function sanitizeListFields<T extends { schedule: ScheduleItem[]; inclusions: string[] }>(draft: T): T {
  return {
    ...draft,
    schedule: draft.schedule
      .map((r) => ({ time: r.time, label: r.label.trim() }))
      .filter((r) => r.time.trim() !== "" || r.label !== ""),
    inclusions: draft.inclusions.map((r) => r.trim()).filter((r) => r !== ""),
  };
}
export const categoryInputSchema = z.object({
  code: z.string().trim().min(1, "Code required"),
  label: z.string().trim().min(1, "Label required"),
  distance_km: z.number().min(0).nullable(),
  base_price: intNonNeg,   // centavos
  slots_total: intNonNeg,
  // Per-distance detail — all optional, null means "not published" rather than
  // zero. DB checks: elevation_gain_m 0-30000, cutoff_hours 0-240 with at most
  // one decimal (numeric(4,1)). Mirrored here so a violation surfaces as a
  // form message instead of a raw Postgres error.
  elevation_gain_m: z.number().int().min(0, "0-30000m").max(30000, "0-30000m").nullable(),
  cutoff_hours: z.number()
    .min(0, "0-240 hours").max(240, "0-240 hours")
    .refine((v) => Math.round(v * 10) === v * 10, "At most one decimal place")
    .nullable(),
  blurb: z.string().nullable(),
});
export const addonInputSchema = z.object({
  name: z.string().trim().min(1, "Name required"),
  price: intNonNeg,        // centavos
});

export type EventInput = z.infer<typeof eventInputSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type AddonInput = z.infer<typeof addonInputSchema>;
