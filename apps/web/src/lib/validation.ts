import { z } from "zod";

// 'cancelled' is set via the Cancel modal, not the editor status field.
export const EVENT_STATUSES = ["draft", "open", "almost_full", "closed", "completed"] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable();
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM").nullable();
const intNonNeg = z.number().int().min(0);

export const eventInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  city_psgc_code: z.string().nullable(),
  region_name: z.string().nullable(),
  province_name: z.string().nullable(),
  city_name: z.string().nullable(),
  venue: z.string().nullable(),
  event_date: dateStr,
  flag_off: timeStr,
  status: z.enum(EVENT_STATUSES),
  elevation_gain_m: intNonNeg.nullable(),
  cutoff_hours: intNonNeg.nullable(),
  description: z.string().nullable(),
  hero_image_url: z.string().nullable(),
  gallery: z.array(z.string()).default([]),
});
export const categoryInputSchema = z.object({
  code: z.string().trim().min(1, "Code required"),
  label: z.string().trim().min(1, "Label required"),
  distance_km: z.number().min(0).nullable(),
  base_price: intNonNeg,   // centavos
  slots_total: intNonNeg,
});
export const addonInputSchema = z.object({
  name: z.string().trim().min(1, "Name required"),
  price: intNonNeg,        // centavos
});

export type EventInput = z.infer<typeof eventInputSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type AddonInput = z.infer<typeof addonInputSchema>;
