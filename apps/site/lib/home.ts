import { isRegistrationClosed } from "@/lib/eventStatus";
import type { EventRow } from "@/lib/events";

/**
 * Decides which home-page composition to render, based only on how many
 * events are still registerable (mirrors isRegistrationClosed — do not
 * invent a second definition of "registerable" here).
 *
 * "single" is the immersive one-event landing (the launch case: exactly one
 * open/almost_full race). "multi" is today's hero + grid. "empty" is a
 * deliberate no-races state — it can still happen with a full events table
 * if everything in it is cancelled/closed/completed.
 */
export function homeMode(events: Pick<EventRow, "status">[]): "single" | "multi" | "empty" {
  const registerable = events.filter((e) => !isRegistrationClosed(e.status));
  if (registerable.length === 1) return "single";
  if (registerable.length >= 2) return "multi";
  return "empty";
}
