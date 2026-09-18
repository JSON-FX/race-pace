/** A booking actor and its participant are distinct identities. Never grant
 * access through an email, display name or arbitrary Passport manager. */
export function canAccessBooking(
  actorId: string | null | undefined,
  booking: { user_id: string | null; booked_by_user_id?: string | null } | null | undefined,
): boolean {
  return !!actorId && !!booking &&
    (booking.user_id === actorId || booking.booked_by_user_id === actorId);
}
