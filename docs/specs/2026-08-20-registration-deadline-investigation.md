# Investigation · "Pulangi Ultra" is Open in admin but missing from the storefront home

**Date:** 2026-08-20 · **Status:** investigation only, nothing changed
**Event:** `05fee0ff-dc49-48e0-99a1-e2f94ac192f6` — Pulangi Ultra, org Muspo
**Reported:** event shows on `/events` but home says "No races are open for entry
right now"; admin shows status **Open**.

---

## Verdict

Not a display bug and not a caching problem. **The event's registration deadline
was already in the past when the event was saved.**

```
registration_closes_at   2026-08-20 05:30:00+00   =  1:30 PM Asia/Manila
created_at               2026-08-20 05:42:23+00   =  1:42 PM Asia/Manila
```

The deadline expired **12 minutes and 23 seconds before the event row existed**.
Every runner-facing surface that asks "can someone enter this race?" correctly
answers no. The one surface that says "Open" — the admin badge — is the only one
that never asks the question.

The race is `status = 'open'`, in the future (16–17 Sep 2026), with 1200 free
slots. It is unenterable purely because of that one timestamp.

---

## Evidence

Queried against hosted `whaqarofxdlzxrelbcrq`:

| Column | Value |
| --- | --- |
| `name` | Pulangi Ultra |
| `status` | `open` |
| `event_date` / `end_date` | 2026-09-16 / 2026-09-17 |
| `original_date` | `null` |
| `registration_closes_at` | **2026-08-20 05:30:00+00** |
| `deadline_passed` (`<= now()`) | **`true`** |
| `created_at` | 2026-08-20 05:42:23+00 |

The admin edit form corroborates it: **Registration closes — 08/20/2026, 01:30 PM**,
with the form's own note "Times are in Asia/Manila". 1:30 PM Manila is 05:30 UTC.
The stored value and the typed value agree, so there is no timezone conversion bug
in `toLocalInput`/`fromLocalInput` (`apps/web/lib/deadlines.ts`). The value in the
database is exactly what was entered.

---

## The single rule behind it

`apps/site/lib/eventStatus.ts:12` — `isRegistrationClosed`:

```ts
if (["cancelled", "closed", "completed"].includes(status)) return true;
if (!registrationClosesAt) return false;
return new Date(registrationClosesAt).getTime() <= Date.now();
```

Status `open` clears the first check. The deadline is set, so the second check is
skipped. The third returns `true`. **A past deadline closes registration regardless
of status** — that is the documented intent, not a defect.

---

## Why each surface disagrees

Home and `/events` call the *same* query, `fetchMarketplaceEvents(db)`. The data is
identical. Everything after it differs.

| Surface | What it consults | Result |
| --- | --- | --- |
| Admin events list | `EventStatusBadge status={row.original.status}` — enum **only** (`StatusBadge.tsx:82`) | **"Open"** |
| Admin edit form | raw field values, no cross-check | shows the past deadline, silently |
| Site home `/` | `homeMode()` → `isRegistrationClosed` (`lib/home.ts:21`) | **hidden** — "empty" mode |
| Site catalog `/events` | `applyFilters` — bands, terrain, province. **Zero** status or deadline logic (`lib/eventFilters.ts:103`) | **shown** |
| Site event page `/events/[id]` | `isRegistrationClosed` (`page.tsx:57`) | "Registration closed" per category |
| `/register/[categoryId]` | `isRegistrationClosed` (`page.tsx:32`) | entry blocked |
| `/pay/[registrationId]` | `isRegistrationClosed` (`page.tsx:39`) | payment blocked |

So `/events` is the outlier, and deliberately so — it is "the full field" and is
meant to list finished and closed races too. Home is the one that filters to
registerable races. Both are behaving as designed.

The admin badge is the genuine inconsistency: it reports the enum while six other
places report the effective state.

---

## Two things worth deciding on (no change made)

**1. Nothing stops or flags a deadline in the past.**
`eventInputSchema` (`apps/web/lib/validation.ts:44`) validates that
`registration_closes_at` is a well-formed ISO datetime and nothing more. There is
no `Date.now()` comparison anywhere in that file. The only cross-field rule is
`kitCutoffError`, which checks kit-edit vs registration order — and it passed here,
because kit edits (25 Aug) do fall after registration close (20 Aug). The form was
internally consistent and still produced a dead-on-arrival race.

**2. `homeMode === "empty"` returns early and hides everything.**
`app/page.tsx:23` returns the empty state before the "Been and gone" section can
render. So this event appears nowhere on home — not as open, not as past. The
empty branch does render its "See past races" link, because that is gated on
`events.length > 0`, which is why that button is visible in the screenshot while
no race is. That link is currently the only path from home to this race.

---

## Immediate unblock

This is a data fix, not a code fix. Set **Registration closes** to a future
datetime (or clear it — the field's own hint says "Leave empty to close by status
only"). Home is `dynamic = "force-dynamic"`, so it reflects the change on the next
request with no redeploy.

---

## Options for the durable fix — not implemented, for discussion

1. **Warn in the editor** when `registration_closes_at` is in the past, in the same
   inline style as the existing kit-cutoff message. Cheapest, and catches the
   mistake at the moment it is made. Whether it should block Save or only warn is a
   real question — backdating a deadline is a legitimate way to stop entries.
2. **Make the admin badge tell the truth** — have the events list and dashboard show
   the effective state (status *and* deadline) rather than the bare enum. This is the
   contradiction that made the report confusing. Note `apps/site/lib/eventState.ts`
   already models "effective state ≠ `status`" for the storefront; the admin has no
   equivalent.
3. **Let home show closed-but-upcoming races** instead of returning the empty state
   when the table is non-empty. Bigger product call, and arguably correct behavior
   already — worth deciding separately from 1 and 2.

My recommendation is 1 and 2 together: they address the two places that misled you,
and neither changes registration semantics. 3 is a product decision, not a bug fix.
