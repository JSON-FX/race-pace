import { z } from "zod";

export const PROOF_MAX_BYTES = 10_000_000;
export const PROOF_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const prescreeningParticipantSchema = z.object({
  participant_passport_id: z.string().uuid(),
  category_id: z.string().uuid(),
  proof_upload_id: z.string().uuid().optional(),
  explanation: z.string().trim().max(4000).optional(),
}).strict();

export const prescreeningRequestSchema = z.object({
  event_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
  checkout_intent: z.enum(["entry", "reservation"]),
  participants: z.array(prescreeningParticipantSchema).min(1).max(10)
    .refine(lines => new Set(lines.map(line => line.participant_passport_id)).size === lines.length, "duplicate_participants")
    .transform(lines => [...lines].sort((a, b) => a.participant_passport_id.localeCompare(b.participant_passport_id))),
}).strict();
export type PrescreeningRequest = z.infer<typeof prescreeningRequestSchema>;

export const categoryReservationRequestSchema = z.object({
  event_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
  prescreening_batch_id: z.string().uuid().optional(),
  participants: z.array(prescreeningParticipantSchema.pick({ participant_passport_id: true, category_id: true })).min(1).max(10)
    .refine(lines => new Set(lines.map(line => line.participant_passport_id)).size === lines.length, "duplicate_participants")
    .transform(lines => [...lines].sort((a, b) => a.participant_passport_id.localeCompare(b.participant_passport_id))),
}).strict();

export type PrescreeningDecision = "pending" | "approved" | "not_required" | "rejected";
export type PrescreeningBatchStatus = "reviewing" | "ready" | "completed" | "cancelled" | "expired";
