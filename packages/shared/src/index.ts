// @race-pace/shared — TypeScript types + validators shared by
// mobile (Expo), web (Vite), and Supabase Edge Functions (Deno).
//
// Keep this framework-agnostic: no React, no Node/Deno-specific APIs — just
// types and Zod schemas so every surface validates identically.

import { z } from "zod";

/** Roles (PRD §8). Platform vs org scope is enforced via user_roles.org_id. */
export const ROLES = ["user", "marshal", "editor", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

/** Category distance codes (PRD §6). */
export const CATEGORY_CODES = ["100k", "50k", "21k", "10k"] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

/** Registration status (PRD §6). */
export const REGISTRATION_STATUS = ["pending", "paid", "refunded", "cancelled"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUS)[number];

/** Types an organization can add to its registration form (PRD §5.1 / §6 form_fields). */
export const FIELD_TYPES = ["text", "number", "select", "checkbox", "date", "file"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Definition of one org-configured custom registration field. */
export const formFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(), // used by "select"
});
export type FormField = z.infer<typeof formFieldSchema>;

/** Profile-owned attributes: prefill into registration + save back (Model B bridge). */
export const PROFILE_KEYS = ["bib_name","date_of_birth","gender","shirt_size","blood_type","emergency_contact"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export const isProfileKey = (k: string): k is ProfileKey => (PROFILE_KEYS as readonly string[]).includes(k);

/** Canonical option lists reused by Profile + Register selects. Store plain ASCII. */
export const BLOOD_TYPES = ["A+","A-","B+","B-","O+","O-","AB+","AB-","Unknown"] as const;
export const SHIRT_SIZES = ["XS","S","M","L","XL","XXL"] as const;
export const GENDERS     = ["Male","Female","Non-binary","Prefer not to say"] as const;

/**
 * Build a Zod validator for a registration's `custom_data` from an org's field
 * definitions, so mobile, web, and the Edge Function all enforce the same rules.
 */
export function customDataSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let v: z.ZodTypeAny =
      f.type === "number" ? z.number()
      : f.type === "checkbox" ? z.boolean()
      : f.type === "select" ? z.enum([...(f.options ?? [""])] as [string, ...string[]])
      : z.string();
    if (!f.required) v = v.optional();
    shape[f.key] = v;
  }
  return z.object(shape);
}

/** Full registration payload sent to the checkout Edge Function. */
export const registrationInputSchema = z.object({
  event_id: z.string().uuid(),
  category_id: z.string().uuid(),
  addon_ids: z.array(z.string().uuid()).default([]),
  custom_data: z.record(z.unknown()).default({}),
  waiver_accepted: z.boolean(),
  idempotency_key: z.string().min(8),
});
export type RegistrationInput = z.infer<typeof registrationInputSchema>;

/** Format integer centavos as PH pesos, e.g. 150000 -> "₱1,500.00". */
export function formatPeso(centavos: number): string {
  return "₱" + (centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Signed-ticket payload (minted server-side on payment). */
export interface TicketPayload {
  rid: string; // registration id
  eid: string; // event id
  iat: number; // issued-at (unix seconds)
}

/** Standardized PH address (denormalized labels ride on events/profiles). */
export type PsgcAddress = {
  city_psgc_code: string | null;
  city_name: string | null;
  province_name: string | null;
  region_name: string | null;
};

/** "Digos City, Davao del Sur" — null province → just the city; null city → "". */
export function formatAddress(a: Pick<PsgcAddress, "city_name" | "province_name">): string {
  if (!a.city_name) return "";
  return a.province_name ? `${a.city_name}, ${a.province_name}` : a.city_name;
}

/** Compose a date range from two ISO dates using the caller's own single-date
 *  formatter, so "same month/year" logic never needs to live in shared code.
 *  No end date, or end === start, collapses to a single formatted date. */
export function formatDateRange(
  startIso: string | null,
  endIso: string | null,
  formatOne: (iso: string) => string
): string {
  if (!startIso) return "";
  if (!endIso || endIso === startIso) return formatOne(startIso);
  return `${formatOne(startIso)} – ${formatOne(endIso)}`;
}
