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

/** `delete_organization_tx` raises plain Postgres error text (P0001
 *  org_has_payments, P0002 org_not_found), not a structured code, so this is
 *  the one place that pattern-matches on the message. The delete handler used
 *  to compute the code and the HTTP status separately from the same
 *  `.includes` chain, which is how a future edit could give one branch a code
 *  that implies a different status than the one actually returned.
 *
 *  Only org_has_payments gets its own status (409). org_not_found here means
 *  the row vanished between our SELECT and the RPC call — a race, not a
 *  routine 404 — so it is reported as "not_found" but on a 500, same as any
 *  other unexpected RPC failure. */
export function mapDeleteRpcError(message: string | undefined): { code: string; status: number } {
  if (message?.includes("org_has_payments")) return { code: "org_has_payments", status: 409 };
  if (message?.includes("org_not_found")) return { code: "not_found", status: 500 };
  return { code: "server_error", status: 500 };
}
