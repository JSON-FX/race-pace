/** Mirrors apps/mobile/app/event/[id].tsx's `registerable` rule (inverted) and
 *  supabase/functions/_shared/eventStatus.ts, which is the authoritative
 *  server-side copy. `almost_full` is NOT closed — it's still registerable,
 *  just tight on slots. Only these three terminal/blocked statuses stop
 *  registration outright.
 *  Keep this in sync by hand; do not derive one from the other.
 *
 *  `registrationClosesAt` is REQUIRED, not optional, so a new call site cannot
 *  silently skip the deadline — the compiler forces the decision. Pass null
 *  where the event genuinely has no deadline loaded. A closed status always
 *  wins regardless of the date, since it is the organizer's manual override. */
export function isRegistrationClosed(
  status: string,
  registrationClosesAt: string | null,
): boolean {
  if (["cancelled", "closed", "completed"].includes(status)) return true;
  if (!registrationClosesAt) return false;
  return new Date(registrationClosesAt).getTime() <= Date.now();
}
