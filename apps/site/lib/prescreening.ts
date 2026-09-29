"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { Upload } from "tus-js-client";
import { PROOF_MAX_BYTES, PROOF_MIME_TYPES } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/client";

const messages: Record<string, string> = {
  admissions_paused: "New requests are temporarily paused. Existing requests, held slots, and payment deadlines remain unchanged.",
  payment_provider_unavailable: "Payment is temporarily unavailable. Your existing holds and payment deadline are unchanged. Please contact the organizer if the deadline is approaching.",
  payment_methods_unavailable: "Payment methods could not be loaded. Try again; your original payment deadline stays the same.",
  category_capacity_exhausted: "There are not enough places in a selected category. No slots were held. Update your selection and try again.",
  event_capacity_exhausted: "This event no longer has enough places. No slots were held.",
  participant_already_held: "A selected Passport already has a held place or registration for this event. Open your existing request or booking.",
  verified_proof_required: "Upload and verify a proof image for each Passport that requires pre-screening.",
  reservations_not_open: "Reservation sales have closed for a selected category. No slots were held.",
  registration_closed: "Registration has closed. No slots were held.",
  participant_not_accessible: "A selected Passport is no longer available to this account.",
  proof_not_accessible: "This proof is not available to your account.",
  proof_size_invalid: "Choose an image no larger than 10 MB.",
  proof_image_invalid: "This image could not be read. Choose a valid JPEG, PNG, or WebP image.",
  proof_type_invalid: "Choose a JPEG, PNG, or WebP image.",
  proof_dimensions_too_large: "This image could not be processed. Try another JPEG, PNG, or WebP up to 10 MB.",
  proof_upload_incomplete: "The upload is incomplete. Retry the upload before submitting.",
  idempotency_conflict: "This request was already submitted with different details. Open My requests before starting another.",
  extend_payment_deadline_before_approval: "The organizer needs to extend the payment deadline before this request can proceed.",
};
export async function screeningOperation<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke(name, { body });
  if (error) {
    let code = "request_unavailable";
    if (error instanceof FunctionsHttpError) {
      try { const payload = await error.context.json(); if (typeof payload.error === "string") code = payload.error; } catch { /* Transport failure. */ }
    }
    throw new Error(messages[code] ?? "This request could not be completed. Try again; your existing holds remain unchanged.");
  }
  return data as T;
}

export type ProofTicket = { upload_id: string; bucket: string; object_path: string };
export function validateProofFile(file: File): string | null {
  if (!PROOF_MIME_TYPES.some(type => type === file.type)) return "Choose a JPEG, PNG, or WebP image.";
  if (file.size < 1 || file.size > PROOF_MAX_BYTES) return "Choose an image no larger than 10 MB.";
  return null;
}
export async function uploadProof(file: File, ticket: ProofTicket, onProgress: (percent: number) => void, signal: AbortSignal, onUploaded?: () => void): Promise<void> {
  const validation = validateProofFile(file);
  if (validation) throw new Error(validation);
  const db = createClient();
  const { data, error } = await db.auth.getSession(); // Transport token only; the API authorizes with getUser().
  if (error || !data.session) throw new Error("Sign in again to upload your proof.");
  const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (base.hostname.endsWith(".supabase.co")) base.hostname = base.hostname.replace(".supabase.co", ".storage.supabase.co");
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `${base.origin}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000], chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true, removeFingerprintOnSuccess: true,
      headers: { authorization: `Bearer ${data.session!.access_token}`, "x-upsert": "false" },
      metadata: { bucketName: ticket.bucket, objectName: ticket.object_path, contentType: file.type, cacheControl: "0" },
      fingerprint: async () => `racepace-proof:${ticket.upload_id}:${file.size}:${file.lastModified}`,
      onProgress: (sent, total) => onProgress(Math.round(sent / total * 100)),
      onError: () => finish(new Error("Upload interrupted. Retry to resume; uploading alone does not hold a slot.")),
      onSuccess: () => finish(),
    });
    const abort = () => { void upload.abort(); finish(new Error("Upload paused. Retry to resume.")); };
    function finish(cause?: Error) { signal.removeEventListener("abort", abort); if (cause) reject(cause); else resolve(); }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void upload.findPreviousUploads().then(previous => {
      if (signal.aborted) return;
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(() => { if (!signal.aborted) upload.start(); });
  });
  onUploaded?.();
  await verifyProof(ticket);
}

export async function verifyProof(ticket: ProofTicket): Promise<void> {
  await screeningOperation("prescreening-proof", { action: "verify", upload_id: ticket.upload_id });
}
