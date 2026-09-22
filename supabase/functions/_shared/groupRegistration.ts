import { z } from "zod";

// Mirrored under supabase/functions/_shared for the isolated Deno runtime.
export const MAX_GROUP_PARTICIPANTS = 10;
const participant = z.object({
  participant_passport_id: z.string().uuid(),
  category_id: z.string().uuid().optional(),
  addon_ids: z.array(z.string().uuid()).max(20).default([])
    .refine((ids) => new Set(ids).size === ids.length, "duplicate_addons")
    .transform((ids) => [...ids].sort()),
  shirt_size: z.enum(["XS", "S", "M", "L", "XL", "XXL"]).optional(),
  custom_data: z.record(z.unknown()).default({}),
  waiver_accepted: z.literal(true),
  waiver_acceptance_method: z.enum(["signed_in_self", "participant_on_helper_device"]),
}).strict();

export const groupReservationInputSchema = z.object({
  event_id: z.string().uuid(),
  category_id: z.string().uuid().optional(),
  idempotency_key: z.string().uuid(),
  waiver_version_id: z.string().uuid(),
  participants: z.array(participant).min(1).max(MAX_GROUP_PARTICIPANTS)
    .refine((lines) => new Set(lines.map((line) => line.participant_passport_id)).size === lines.length, "duplicate_participants")
    .transform((lines) => [...lines].sort((a, b) => a.participant_passport_id.localeCompare(b.participant_passport_id))),
}).strict().superRefine((input, context) => {
  for (const [index, line] of input.participants.entries()) {
    if (!line.category_id && !input.category_id) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "category_required", path: ["participants", index, "category_id"] });
    }
    if (line.category_id && input.category_id && line.category_id !== input.category_id) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "category_conflict", path: ["participants", index, "category_id"] });
    }
  }
});
export type GroupReservationInput = z.infer<typeof groupReservationInputSchema>;
