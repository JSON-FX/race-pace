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

/** Normalizes `ADMIN_APP_URL` (the secret may or may not carry a trailing
 *  slash — Vercel env values are typed by hand and Docker Compose values are
 *  copy-pasted) and points it at the route Task 6 built to redeem a
 *  server-generated token: `/auth/confirm`. Returns null when no admin URL is
 *  configured so callers can omit `redirectTo` entirely rather than pass a
 *  broken relative URL to Supabase. */
export function adminConfirmRedirect(adminAppUrl: string): string | null {
  const trimmed = adminAppUrl.replace(/\/+$/, "");
  return trimmed ? `${trimmed}/auth/confirm` : null;
}

/** Builds the manual invite link org-provision hands back to the super admin
 *  who just created an organization — the same destination an SMTP-emailed
 *  invite lands on once SMTP is configured (Task 7 design). `type=magiclink`
 *  because the account already exists by the time this runs; `/team` is
 *  where an invited admin with a role but no profile yet is useful.
 *
 *  The RAW action_link from generateLink is deliberately never used here: it
 *  routes through Supabase's /auth/v1/verify, which redirects to `next` with
 *  the tokens in the URL FRAGMENT — unreadable by a server route. This
 *  builds the /auth/confirm link directly from `hashed_token` instead, which
 *  that route redeems with verifyOtp.
 *
 *  Returns null when either input is missing — no admin URL configured, or
 *  generateLink didn't return a token — so the best-effort caller can fall
 *  back to `invite_link: null` rather than construct a broken link. */
export function buildInviteLink(adminAppUrl: string, hashedToken: string | null): string | null {
  const redirect = adminConfirmRedirect(adminAppUrl);
  if (!redirect || !hashedToken) return null;
  return `${redirect}?token_hash=${hashedToken}&type=magiclink&next=%2Fteam`;
}
