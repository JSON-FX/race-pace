"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { groupReservationInputSchema, type GroupReservationInput } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/client";

export type GroupReservation = {
  order_id: string;
  status: string;
  expires_at: string;
  entry_total_cents: number;
  registrations: { registration_id: string; participant_passport_id: string; entry_total_cents: number }[];
};

export type GroupAttempt = {
  id: string;
  booking_order_id: string;
  status: string;
  method: string;
  base_cents: number;
  platform_fee_cents: number;
  gross_cents: number;
  terms_snapshot?: { fee_mode?: "absorb" | "pass_on" };
};

export class GroupCheckoutError extends Error {
  constructor(readonly code: string, readonly participantId?: string) {
    super(code.replaceAll("_", " "));
  }
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke(name, { body });
  if (error) {
    let code = "request_unavailable";
    let participantId: string | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = await error.context.json();
        if (typeof payload?.error === "string") code = payload.error;
        if (typeof payload?.participant_passport_id === "string") participantId = payload.participant_passport_id;
      } catch { /* Keep the transport error. */ }
    }
    throw new GroupCheckoutError(code, participantId);
  }
  return data as T;
}

export function assertGroupSelection(ids: string[], availableSlots: number): void {
  if (ids.length < 1 || ids.length > 10) throw new GroupCheckoutError("participant_count_invalid");
  if (new Set(ids).size !== ids.length) throw new GroupCheckoutError("duplicate_participants");
  if (ids.length > availableSlots) throw new GroupCheckoutError("insufficient_visible_slots");
}

export async function reserveGroup(input: GroupReservationInput): Promise<GroupReservation> {
  return invoke("group-reservations", { ...groupReservationInputSchema.parse(input) });
}

export async function prepareGroupPayment(orderId: string, method: "card" | "gcash" | "maya", key: string): Promise<GroupAttempt> {
  return invoke("group-payment-prepare", { order_id: orderId, method, idempotency_key: key });
}

export async function startGroupPayment(attemptId: string): Promise<{ action: string; checkout_url?: string }> {
  return invoke("group-payment", { attempt_id: attemptId, action: "session" });
}

export async function verifyGroupPayment(attemptId: string): Promise<{ status: string }> {
  return invoke("group-payment", { attempt_id: attemptId, action: "verify" });
}
