# Runner site shell redesign — "Race Day"

Date: 2026-08-06
Scope: `apps/site` — navigation, home, `/events`, `/races`, `/profile`, plus a new footer.
Status: implemented.

## Why

The public event page shipped 2026-08-06 as "Expedition Dossier" and is good. The
shell around it was not:

- `SiteHeader` had **no mobile menu** (four links flat-wrapped at 375px) and **no
  active-route marker**.
- There was **no footer** anywhere on the site.
- `/` and `/events` rendered **the identical card grid** — two routes, one design,
  no reason to visit both.
- `/races` and `/profile` were plain shadcn forms that read like a different
  product from the event page.

Three directions were mocked and compared (Base Camp / Race Day / Topo Atlas).
**Race Day** was chosen: a light, high-key shell with a bib-and-figures motif.

## Decisions

### The single-event home mode is deleted

`homeMode()` returned `"single" | "multi" | "empty"`, and `"single"` made `/`
render the lone open race's full event page. That is gone; it now returns
`"multi" | "empty"`.

A runner landing on `/` should always be able to tell that Race Pace lists
races. A one-race season made the site look like a one-race product. The
featured slab already gives a lone race the whole top of the page, which was
the real intent behind `"single"`.

### Home curates, `/events` filters

That is the whole reason both routes exist:

- **Home** — headline, one **featured slab**, a horizontal **rail** of what's
  opening soon, a four-figure **season band**, and up to three finished races.
- **`/events`** — filter chips over a 3-up grid.

### The featured slab carries three figures, not one

The first mockup put a single number ("24 slots left") in a tall card. The slab
is wide enough to carry vertical gain, longest distance *and* slots left — the
three figures that actually decide entry.

Light by default. A dark variant follows `disciplineLayout()`, the same rule
that already sends trail/ultra event pages to a near-black canvas and road
events to a light one, so the slab previews the page it links to.

### Filters live in the URL

`lib/eventFilters.ts` is pure and fully unit-tested. Every chip is a `<Link>` to
the same route with a different query, never a stateful button. Consequences:
filtered views are shareable, Back steps through filter changes, and the page
works before hydration. The server does the filtering, so there is no client
copy of the rule to drift.

Axes: `bands` and `terrain` are OR-within / AND-across; `province` is
single-select. Distance bands cover `[0, ∞)` with no gaps — a 50K is `ultra`, a
42.195 is `marathon`. An event matches a band if **any** of its distances does.

### My Races leads with the race photo, not a bib plate

An earlier draft used a bib-number plate as the recognition object. Dropped: a
runner scanning the list is looking for *which race*, and the hero image answers
that faster. Finished entries desaturate, so past and upcoming separate without
a second badge.

**There is no bib NUMBER in this system.** The ticket's "Bib" field is the
runner's `bib_name`. The list therefore shows `Ref <id.slice(0,8)>` — derived
exactly as `TicketPanel` derives it, so the two can never disagree.

`registrations.event_id` was added to `REG_SELECT`/`RegistrationRow` so an entry
can link back to its race.

### Profile is a passport, not a form

Read-only spec rows with per-row inline edit. Save only appears once a row is
open. A three-figure strip counts races and kilometres from paid entries
(category distance, not the race's longest) and reports whether the passport is
complete enough to prefill a registration.

## Files

New: `components/SiteNav.tsx`, `components/SiteFooter.tsx`,
`components/FeaturedRace.tsx`, `components/RaceRail.tsx`,
`components/SeasonBand.tsx`, `app/events/EventFilters.tsx`,
`lib/eventFilters.ts` (+ tests), `public/footer-logo.png`,
`public/payments/{gcash,maya,visa,mastercard}.png`.

Changed: `SiteHeader.tsx` (now only reads auth and delegates), `EventCard.tsx`,
`app/page.tsx`, `app/events/page.tsx`, `app/races/{page,RacesList}.tsx`,
`app/profile/{page,ProfileForm}.tsx`, `lib/home.ts`, `lib/registration.ts`.

## Brand assets

- **Header** — `public/topnav-logo.png`, the mark alone.
- **Footer** — `public/footer-logo.png`, the full lockup with wordmark. Copied
  from `apps/mobile/assets/login-logo.png` so the site owns its own asset.
- **Payments** — the providers' own artwork in `public/payments/`. Each PNG
  ships with its own rounded plate, so there is deliberately **no CSS border or
  background** on the `img`.

`components/PaymentLogos.tsx` (hand-drawn inline SVG) is unchanged and still
serves the checkout rows, where a mark renders at 16–22px with zero network
cost.

## Known follow-ups (not done here)

- Both brand PNGs and the four payment PNGs are large (~590KB total) for flat
  vector artwork. SVG would cut that to a few KB and make a knockout variant a
  fill change.
- Both logos are dark-on-transparent, so they only work on light surfaces. The
  mobile sheet uses `brightness-0 invert` as a stopgap; a real white variant
  should replace it.
- No bib-number field exists. If one is ever added, My Races and the ticket
  should both switch to it and drop the `Ref` fallback.
