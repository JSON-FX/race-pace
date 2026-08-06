import { isRegistrationClosed } from "@/lib/eventStatus";
import type { EventRow } from "@/lib/events";

/**
 * Decides which home-page composition to render, based only on how many
 * events are still registerable (mirrors isRegistrationClosed — do not
 * invent a second definition of "registerable" here).
 *
 * There used to be a third mode, "single": with exactly one open race the
 * home page BECAME that race's event page. That's gone as of the shell
 * redesign. Home is a catalog at every size of field, including a field of
 * one — a runner who lands on `/` should always be able to tell that Race
 * Pace lists races, and the old behaviour made a one-race season look like a
 * one-race product. The featured slab already gives a lone race the whole
 * top of the page, which was the real intent behind "single".
 *
 * "empty" is a deliberate no-races state — it can still happen with a full
 * events table if everything in it is cancelled/closed/completed.
 */
export function homeMode(events: Pick<EventRow, "status">[]): "multi" | "empty" {
  const registerable = events.filter((e) => !isRegistrationClosed(e.status));
  return registerable.length > 0 ? "multi" : "empty";
}
