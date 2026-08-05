import { z } from "zod";
import { EVENT_DISCIPLINES } from "@race-pace/shared";

// 'cancelled' is set via the Cancel modal, not the editor status field.
export const EVENT_STATUSES = ["draft", "open", "almost_full", "closed", "completed"] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable();
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM").nullable();
const scheduleTimeStr = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
const intNonNeg = z.number().int().min(0);

/** One race-morning timeline row. Both fields required — a blank row isn't a
 *  meaningful entry, so it's dropped from the array before save rather than
 *  persisted as a partial row. */
export const scheduleItemSchema = z.object({
  time: scheduleTimeStr,
  label: z.string().trim().min(1, "Label required"),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

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
  description: z.string().nullable(),
  hero_image_url: z.string().nullable(),
  gallery: z.array(z.string()).default([]),
  schedule: z.array(scheduleItemSchema).default([]),
});
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
