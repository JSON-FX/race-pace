# Events Marketplace Redesign (Mobile)

**Status:** Approved, ready for implementation plan
**Scope:** `apps/mobile` — the Events tab / marketplace screen only
**Branch:** `worktree-events-marketplace-redesign` (isolated worktree at `.claude/worktrees/events-marketplace-redesign`)

## 1. Goals

Redesign the mobile Events Marketplace (`app/(tabs)/events.tsx`) to address four things, all confirmed with the user:

1. **Visual refresh** — move off the plain flat-list-of-cards look.
2. **Discovery & filtering** — let runners filter by location, date, distance, and organizer, combinable (AND).
3. **Featured/upcoming highlight** — surface the soonest upcoming race(s) instead of treating every event identically.
4. **Organizer presence** — give orgs a stronger visual identity on each card.

## 2. Non-goals

- No `is_featured` schema/admin change — "featured" is purely computed from `event_date` (soonest non-cancelled upcoming events).
- No sticky multi-chip filter bar with per-chip sheets (the originally-proposed "Approach A" chip row) — superseded by the single inline date-segment + "More filters" sheet pattern decided during visual review.
- No A–Z index rail on the Organizer picker — dropped after review; search + sticky section headers carry it.
- No new UI dependency (no bottom-sheet library, no new component kit) — everything is built from existing RNR primitives already in `apps/mobile/components/ui/`.

## 3. Final visual design

Confirmed through the visual brainstorming session (mockups discarded, decisions captured here):

- **Featured section** ("Coming up soon"): one full-width hero at a time, swipeable, with dot pagination. Pulled from the soonest 1–3 upcoming events (`status != 'cancelled'`, sorted by `event_date` ascending).
- **Event card**: immersive-overlay style — hero image with a bottom gradient, event name/org/place/date and distance pills sit directly on the image, status badge top-left, org logo as a small corner avatar top-right.
- **Filter bar**: inline segmented control for date range (This week / This month / Later / All) using `ToggleGroup`, plus a single "More filters" row/button (with an active-filter-count badge) that opens a bottom sheet for Region, Distance, and Organizer.
- **Filter sheet**: a bottom-anchored restyle of the existing `Dialog` component (rounded top corners, slides up, scrim). Contains:
  - **Region** — a nav row that opens a dedicated region/province/city picker (reuses `usePsgcRegions`/`usePsgcProvinces`/`usePsgcCities`).
  - **Distance** — a wrapping grid of pressable pills for standard buckets (see §4.3).
  - **Organizer** — a nav row that opens a dedicated searchable picker (see §4.4).
  - Cancel / "Show N events" footer, with a live count of events matching the in-progress filter selection.
- **List body**: grouped under sticky date-section headers ("This month", "Later", etc.) matching whatever the date-segment currently selects.
- **Past events**: collapsed by default under a "Past events — Show" row at the bottom of the list; expanding it reveals completed/cancelled events, unaffected by the upcoming-only default.

## 4. Data & filtering model

### 4.1 Default scope (upcoming only)

Default query excludes:
- `status = 'cancelled'`
- `status = 'completed'`
- events whose `event_date < today`

The "Past events" toggle removes this exclusion and instead shows only what's excluded above (past/completed/cancelled), still respecting the other active filters (region/distance/organizer).

### 4.2 Date segment

Client-computed buckets against `event_date`, applied on top of the upcoming-only scope:
- **This week**: today ≤ `event_date` < today+7d
- **This month**: today ≤ `event_date` < end of current calendar month
- **Later**: `event_date` ≥ end of current calendar month
- **All**: no additional date constraint (still upcoming-only unless Past events is toggled)

### 4.3 Distance buckets

Selecting a bucket matches events that have **any** category whose `distance_km` falls in range. Buckets (adjustable later, not exact-match since trail distances are irregular — e.g. 25K, 15K, 80K all show up in real data):

| Bucket | Range (km) |
|---|---|
| 5K | 0–7 |
| 10K | 7–15 |
| 21K | 15–25 |
| 42K | 25–45 |
| 50K+ | 45–75 |
| Ultra | 75+ |

**Implementation (simplified during planning):** `lib/events.ts` already embeds `categories(slots_taken)` per event to compute `joined_count` — extending that same embed with `distance_km` gives every event a `distances: number[]` field for free, with no extra query. Distance-bucket matching (and every other filter) then runs entirely client-side over the already-fetched event list, the same way today's text search already works — there's no realistic dataset size here that needs query-side filtering, and this keeps `useMarketplaceEvents()` itself unchanged.

### 4.4 Organizer filter

Multi-select. Backed by a dedicated picker screen/sheet:
- Reuses `useOrgs()` (already returns `event_count` per org via the existing join).
- Filtered client-side to orgs with `event_count > 0`.
- Search box (reuses `Input`) filters the list live by name.
- Results grouped under sticky first-letter section headers (no A–Z index rail).
- Selected orgs shown as removable tags above the list.
- Applying constrains the displayed list to events whose `org_id` is in the selected set (client-side, see §4.6).

### 4.5 Region filter

Single picker (not full cascading-required-to-city like the profile's `PsgcAddressPicker` — filter semantics allow stopping at Region or Province, unlike the profile address which requires a city). Reuses the same `usePsgcRegions`/`usePsgcProvinces`/`usePsgcCities` hooks and `Select` primitive, but as a new lightweight component rather than reusing `PsgcAddressPicker` directly, since that component's contract (`onChange` only fires once a City is picked) doesn't fit "filter by region alone."

Matches client-side against whichever level the user drilled to (`city_name`, else `province_name`, else `region_name` — events table already carries these denormalized).

### 4.6 Combining filters (client-side, pure functions)

All filtering — region, date segment, distance buckets, organizer, upcoming/past scope — runs client-side in a new pure module, `lib/marketplaceFilters.ts` (no Supabase, no React; plain functions over `EventRow[]`), applied as one AND-combination via a single `filterMarketplaceEvents(events, filters, todayIso)` function. Search (existing name/place text search in `events.tsx`) continues to apply on top of that filtered result set, unchanged from today. This module is also where date-segment ranges, distance-bucket ranges, upcoming/past classification, and the "soonest N events" featured-picking logic live — all pure and unit-testable without mocking Supabase or React Query.

## 5. Component architecture

| Component | File | Notes |
|---|---|---|
| `Marketplace` screen | `app/(tabs)/events.tsx` | Orchestrates filter state, applies `filterMarketplaceEvents`, renders the sections below. Existing search bar and pull-to-refresh (`useGlobalRefresh`) stay; "Filters" button added next to search. |
| `lib/marketplaceFilters.ts` | new, pure | Date-segment ranges, distance-bucket ranges, upcoming/past classification, `filterMarketplaceEvents`, `pickFeaturedEvents`, `groupEventsForDisplay`, `countActiveFilters`. No Supabase/React dependency — the bulk of this feature's real logic, and the easiest to test thoroughly. |
| `FeaturedCarousel` | `components/FeaturedCarousel.tsx` (new) | Paged hero with dot pagination, fed the soonest 1–3 upcoming events via `pickFeaturedEvents`. |
| `EventCard` | `components/EventCard.tsx` (redesign in place) | Immersive-overlay layout; keeps existing `imgFailed` → `ElevationHero` fallback behavior, `joined_count`/date-range display. |
| `MarketplaceFilterBar` | `components/MarketplaceFilterBar.tsx` (new) | `ToggleGroup`-based date segment + "More filters" row with count badge. |
| `MarketplaceFilterSheet` | `components/MarketplaceFilterSheet.tsx` (new) | Bottom-anchored `Dialog` restyle; hosts Region/Distance/Organizer rows + Cancel/Apply footer with live count (computed via `filterMarketplaceEvents` against the draft selection). |
| `RegionFilterPicker` | `components/RegionFilterPicker.tsx` (new) | Region → Province → City, each level independently selectable as the filter value. |
| `OrganizerFilterPicker` | `components/OrganizerFilterPicker.tsx` (new) | Search + sectioned multi-select list, reuses `useOrgs()` and `OrgAvatar`. |
| `lib/events.ts` | updated | `EVENT_COLS`'s `categories` embed gains `distance_km`; `mapEvent` gains a computed `distances: number[]`. `useMarketplaceEvents()` itself is otherwise unchanged. |

### Reusable component library usage (maximized per the request)

- `ToggleGroup` / `ToggleGroupItem` — date segment control (currently unused elsewhere in the app; first real use).
- `Dialog` (restyled, bottom-anchored) — filter sheet. No new dependency.
- `Badge` (`asChild`, wrapping a `Pressable`) — distance bucket pills and the status badge, reusing the existing `eventStatusKind`/`StatusBadge` logic with an added "on-image" translucent style.
- `Checkbox` — organizer multi-select rows (or a simple checked/unchecked `Pressable` circle matching the mockup — implementation plan decides based on how close `Checkbox`'s default look gets to the design without excessive overriding).
- `Input` — organizer search box; also an opportunity to migrate the existing marketplace/org search `TextInput` to `Input` for consistency (not required, but flagged since we're already touching this screen).
- `Avatar`/`OrgAvatar` — org logos, unchanged component, reused in the card, hero, and organizer picker.
- `Select` — underlies `RegionFilterPicker`'s per-level pickers, same as `PsgcAddressPicker` already does.
- `Card`, `Text`, `Icon`, `Button` — unchanged, reused as today.

## 6. Error handling & empty states

- Existing retry-on-error pattern (`isError` → tap to retry) is preserved for the main events query.
- Each image (`hero_image_url`) keeps the existing `imgFailed` → `ElevationHero` gradient fallback, applied consistently across `FeaturedCarousel` and `EventCard`.
- Empty state when a filter combination yields zero events: distinct from the current no-search-results empty state — includes a "Clear filters" action, not just "try a different search."
- Organizer/Region pickers: normal empty-search state ("No organizers match \"...\"").

## 7. Testing

Extend existing coverage rather than starting fresh:
- `__tests__/event-card.test.tsx` — update for the new overlay layout (status badge, org avatar, distance pills all still present, image-fail fallback still works).
- `__tests__/marketplace-search.test.tsx` — extend for filter state (date segment, at least one combined filter case) alongside existing text search.
- `__tests__/events-hooks.test.tsx` — extend for the new `distances` field (categories embed now includes `distance_km`).
- New: `__tests__/marketplace-filters.test.ts` — pure unit tests for `lib/marketplaceFilters.ts` (date segments, distance buckets, upcoming/past, combined AND-filtering, featured picking, section grouping). No mocking needed.
- New: `FeaturedCarousel` render + pagination test.
- New: `MarketplaceFilterBar`/`MarketplaceFilterSheet` interaction test (opening the sheet, selecting filters, "Show N events" count, applying).
- New: `OrganizerFilterPicker` search-filters-list + multi-select test.

## 8. Rollout

Single branch, no feature flag — implemented directly in the isolated worktree (`worktree-events-marketplace-redesign`) and merged when ready, consistent with this project's solo-dev/speed-to-MVP workflow.
