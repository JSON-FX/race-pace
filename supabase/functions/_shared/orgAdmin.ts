// Pure helpers for the organization-management actions on org-provision.
// Split out for the same reason _shared/team.ts is: the Edge Function itself
// has no HTTP test harness in this repo, so anything with a decision in it
// lives here where it can be unit-tested.

/** Rename validation. The SLUG is immutable — it is in live event URLs and in
 *  any link an organizer has already shared — so `name` is the only field a
 *  rename may touch. */
export function validateRename(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "name_required";
  if (trimmed.length > 120) return "name_too_long";
  return null;
}

export type SettledCounts = { paid: number; refunded: number; partially_refunded: number };

/** Money moved, so the ledger cannot be erased. Suspend is the answer for a
 *  live organization; there is no override. */
export function isDeleteBlocked(c: SettledCounts): boolean {
  return c.paid + c.refunded + c.partially_refunded > 0;
}

/** The two buckets an organization owns files in. Objects are keyed
 *  <bucket>/<org_id>/<uuid>.<ext> — see 20260721110000_event_images_storage.sql
 *  and 20260724130000_org_images.sql. */
export function orgStoragePrefixes(orgId: string): { bucket: string; prefix: string }[] {
  return [
    { bucket: "event-images", prefix: orgId },
    { bucket: "org-images", prefix: orgId },
  ];
}
