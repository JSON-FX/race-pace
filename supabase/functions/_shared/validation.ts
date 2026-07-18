// Deno-side copy of the registration validators. Canonical source for app/web is
// packages/shared; the local Supabase edge runtime only mounts supabase/functions/,
// so it cannot import packages/shared — KEEP THESE IN SYNC with packages/shared.
import { z } from "zod";

export const FIELD_TYPES = ["text", "number", "select", "checkbox", "date", "file"] as const;

export const formFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

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

export const registrationInputSchema = z.object({
  event_id: z.string().uuid(),
  category_id: z.string().uuid(),
  addon_ids: z.array(z.string().uuid()).default([]),
  custom_data: z.record(z.unknown()).default({}),
  waiver_accepted: z.boolean(),
  idempotency_key: z.string().min(8),
});
