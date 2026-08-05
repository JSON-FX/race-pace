/** Mirrors apps/mobile/app/event/[id].tsx's `registerable` rule (inverted).
 *  `almost_full` is NOT closed — it's still registerable, just tight on
 *  slots. Only these three terminal/blocked statuses stop registration.
 *  Keep this in sync with mobile by hand; do not derive one from the other. */
export function isRegistrationClosed(status: string): boolean {
  return ["cancelled", "closed", "completed"].includes(status);
}
