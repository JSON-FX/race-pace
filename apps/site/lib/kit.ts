import { createClient } from "@/lib/supabase/client";

/** Kit fields freeze at the event's cutoff so shirts can be printed and packed against a
 *  stable roster. This decides what the UI RENDERS; update_registration_fields_tx decides
 *  what is actually allowed. The comparison is strict (`<`) to match the RPC's own
 *  `v_kit_closes < now()` gate exactly, so the two never disagree at the boundary instant. */
export function kitEditLocked(kitEditClosesAt: string | null): boolean {
  if (!kitEditClosesAt) return false;
  return new Date(kitEditClosesAt).getTime() < Date.now();
}

/** Whole days remaining, rounded up: a deadline later today reads as "1 day left" rather
 *  than "0 days left", which would look like it had already passed. */
export function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/** A bare date reads as trivia; time remaining reads as an instruction. Inside the final
 *  week the relative form carries the urgency, and before that the absolute date is what a
 *  runner actually plans around. Returns null once the deadline passes, because the closed
 *  state already says so more clearly than a countdown could. */
export function deadlineNotice(registrationClosesAt: string | null): string | null {
  if (!registrationClosesAt) return null;
  const days = daysUntil(registrationClosesAt);
  if (days === 0) return null;
  if (days <= 7) return `Closes in ${days} ${days === 1 ? "day" : "days"}`;
  const when = new Date(registrationClosesAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Registration closes ${when}`;
}

export type KitEditResult = "ok" | "locked" | "not_editable" | "no_change" | "error";

const KNOWN_RESULTS: readonly KitEditResult[] = ["ok", "locked", "not_editable", "no_change", "error"];

/** The RPC is the authority — identity comes from auth.uid() inside it, and it decides
 *  whether the edit is allowed. The client's clock only decided what to render, so a
 *  runner who opens the page at 11:58pm and saves at 12:01am gets 'locked' back here,
 *  not a silent 'ok'. Anything the RPC returns that we don't recognise collapses to
 *  'error' rather than being passed through and trusted by the caller. */
export async function updateShirtSize(registrationId: string, size: string): Promise<KitEditResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_registration_fields_tx", {
    p_registration_id: registrationId,
    p_changes: { shirt_size: size },
  });
  if (error) return "error";
  return KNOWN_RESULTS.includes(data as KitEditResult) ? (data as KitEditResult) : "error";
}

/** Messages for the results a runner can actually hit from the sheet. 'ok' and
 *  'no_change' are silent successes; 'not_found' and 'forbidden' can't occur here
 *  (the sheet only ever targets the signed-in runner's own loaded registration) and
 *  fall through to the generic message like any other unexpected result. */
export function kitEditMessage(result: KitEditResult): string | null {
  switch (result) {
    case "ok":
    case "no_change":
      return null;
    case "locked":
      return "Shirt sizes are closed for this race. Contact the organiser to change yours.";
    case "not_editable":
      return "This registration can no longer be changed.";
    default:
      return "We couldn't save that. Please try again.";
  }
}
