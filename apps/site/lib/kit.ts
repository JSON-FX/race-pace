/** Kit fields freeze at the event's cutoff so shirts can be printed and packed against a
 *  stable roster. This decides what the UI RENDERS; update_registration_fields_tx decides
 *  what is actually allowed. If the two disagree the RPC wins and returns 'locked'. */
export function kitEditLocked(kitEditClosesAt: string | null): boolean {
  if (!kitEditClosesAt) return false;
  return new Date(kitEditClosesAt).getTime() <= Date.now();
}

/** Whole days remaining, rounded up: a deadline later today reads as "1 day left" rather
 *  than "0 days left", which would look like it had already passed. */
export function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}
