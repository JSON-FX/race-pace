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

/** `delete_organization_tx` (20260818120000_org_management.sql) raises with a
 *  real SQLSTATE — `using errcode = 'P0001'` for org_has_payments, 'P0002'
 *  for org_not_found — and supabase-js puts that on `error.code`. The
 *  SQLSTATE is the primary discriminator; matching on the message text is
 *  only a fallback for an error that somehow arrives with no code, because a
 *  future reword of the raise text must not silently turn a blocked delete
 *  into a 500 instead of a 409. Kept as one function so the code and the
 *  HTTP status can never drift apart — the handler used to compute this
 *  twice and could return one status with a code that implies another.
 *
 *  Per spec §9's edge-case table ("Two operators delete the same org →
 *  Second call finds no row and returns not_found (404)"), org_not_found is
 *  a routine 404, not a 500. */
export function mapDeleteRpcError(
  err: { code?: string | null; message?: string | null } | undefined,
): { code: string; status: number } {
  if (err?.code === "P0001") return { code: "org_has_payments", status: 409 };
  if (err?.code === "P0002") return { code: "not_found", status: 404 };
  if (err?.message?.includes("org_has_payments")) return { code: "org_has_payments", status: 409 };
  if (err?.message?.includes("org_not_found")) return { code: "not_found", status: 404 };
  return { code: "server_error", status: 500 };
}
