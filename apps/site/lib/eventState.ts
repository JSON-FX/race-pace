import type { EventRow } from "@/lib/events";

/**
 * The state a runner actually needs to see on a card, which is NOT the same
 * thing as `events.status`.
 *
 * Two of the states an organizer can put an event into are not enum values at
 * all, and neither was visible anywhere before this:
 *  - **Ongoing** — no such status exists. A race is underway when today falls
 *    inside [event_date, end_date]. Organizers flip status to `closed` when
 *    the gun goes, so without this the catalog said "Closed" for a race that
 *    is happening right now.
 *  - **Rescheduled** — carried by `original_date` being set (see the
 *    marketplace_fields migration), not by status.
 *
 * Order matters and is by severity, not by field: a cancelled race is
 * cancelled even if its dates bracket today, and a rescheduled race that has
 * since started reads as ongoing.
 */
export type EventState =
  | "cancelled"
  | "ongoing"
  | "rescheduled"
  | "almost_full"
  | "closed"
  | "completed"
  | "open";

type StateInput = Pick<EventRow, "status" | "event_date" | "end_date" | "original_date">;

/** `today` is injectable so tests don't depend on the day they run. Both it
 *  and the columns are "YYYY-MM-DD", so string compare IS date compare — and
 *  it avoids the timezone shift a Date round-trip would introduce. */
export function eventState(event: StateInput, today = new Date().toISOString().slice(0, 10)): EventState {
  if (event.status === "cancelled") return "cancelled";

  const start = event.event_date;
  // A single-day race is its own window: end_date is null for most events, so
  // falling back to `start` is what makes "today is race day" count as ongoing.
  const end = event.end_date ?? start;
  if (start && end && start <= today && today <= end) return "ongoing";

  if (event.status === "completed") return "completed";
  if (event.original_date) return "rescheduled";
  if (event.status === "almost_full") return "almost_full";
  if (event.status === "closed") return "closed";
  return "open";
}

/** Label + tint per state. `open` gets no badge — the absence of a badge is
 *  the signal, and badging every card would flatten the ones that matter. */
export const STATE_BADGE: Record<Exclude<EventState, "open">, { label: string; className: string }> = {
  cancelled: { label: "Cancelled", className: "bg-destructive text-destructive-foreground" },
  ongoing: { label: "Happening now", className: "bg-primary text-primary-foreground" },
  rescheduled: { label: "Rescheduled", className: "bg-amber text-white" },
  almost_full: { label: "Almost full", className: "bg-amber text-white" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
  completed: { label: "Completed", className: "bg-muted text-muted-foreground" },
};
