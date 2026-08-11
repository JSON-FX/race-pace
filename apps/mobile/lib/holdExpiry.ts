/** True once a pending registration's payment hold has run out — whether or
 *  not the 15-minute sweep has caught up to flip `status` to `expired` yet.
 *  `status` stays literally `'pending'` in the data until that sweep runs, so
 *  every caller must derive "is this hold actually still live" from
 *  `expires_at`, not from `status` alone.
 *
 *  Canonical version: apps/site/lib/holdExpiry.ts. This is a deliberate copy,
 *  not a shared import — apps/mobile and apps/site are separate deployables
 *  (Expo vs. Next.js, no shared package boundary crosses that line today), so
 *  the same one-line rule has to be duplicated rather than imported. Keep the
 *  two in sync by hand; apps/mobile/app/event/[id].tsx already inlines this
 *  exact check with the same cross-reference in its own comment. */
export function holdExpired(status: string, expiresAt: string | null): boolean {
  return status === "pending" && !!expiresAt && Date.parse(expiresAt) <= Date.now();
}
