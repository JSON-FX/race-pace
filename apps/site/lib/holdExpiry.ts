/** True once a pending registration's payment hold has run out — whether or
 *  not the 15-minute sweep has caught up to flip `status` to `expired` yet.
 *  `status` stays literally `'pending'` in the data until that sweep runs, so
 *  every caller must derive "is this hold actually still live" from
 *  `expires_at`, not from `status` alone.
 *
 *  This is the one rule three different places need to agree on: the event
 *  page (`lib/entry.ts`'s `fetchMyEntry`), My Races (`app/races/RacesList.tsx`),
 *  and registrations-checkout (the edge function, the authoritative version —
 *  this mirrors it for display purposes only, it never gates anything the
 *  server itself enforces). No "use client"/"use server" directive on this
 *  file on purpose: it needs to be safely importable from both a Server
 *  Component (`fetchMyEntry` runs during SSR) and a client component
 *  (`RacesList`), and a plain pure function has no boundary to cross either
 *  way — only the two site-side call sites are unified here; the edge
 *  function lives in `supabase/` and is out of reach from this package. */
export function holdExpired(status: string, expiresAt: string | null): boolean {
  return status === "pending" && !!expiresAt && Date.parse(expiresAt) <= Date.now();
}
