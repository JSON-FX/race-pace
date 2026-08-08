/** Mirrors apps/site/lib/eventStatus.ts's `isRegistrationClosed` (and
 *  apps/mobile/app/event/[id].tsx's `registerable` rule, inverted).
 *  `almost_full` is NOT closed — it's still registerable, just tight on
 *  slots. Only these three terminal/blocked statuses stop registration.
 *  Kept in sync by hand across site/mobile/functions; do not derive one
 *  from another.
 *
 *  This is the authoritative check: registrations-checkout must reject a
 *  closed event's registration server-side, since the page-level check is
 *  only a UX nicety and can be bypassed by a direct request.
 *
 *  `registrationClosesAt` is REQUIRED rather than optional so that adding a
 *  call site cannot silently skip the deadline — the compiler forces the
 *  decision. Pass null where the event genuinely has no deadline loaded.
 *  A closed status always wins regardless of the date. */
export function isRegistrationClosed(
  status: string,
  registrationClosesAt: string | null,
): boolean {
  if (["cancelled", "closed", "completed"].includes(status)) return true;
  if (!registrationClosesAt) return false;
  return new Date(registrationClosesAt).getTime() <= Date.now();
}
