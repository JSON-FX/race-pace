# Event Cards UX Polish — design

- **Product:** Race Pace — mobile runner app (`apps/mobile`) + admin dashboard (`apps/web`)
- **Status:** Draft v0.1 (approved to plan)
- **Last updated:** 2026-07-22
- **Owner:** Product (jayson@voltcontent.com)
- **Feeds:** superpowers:writing-plans → implementation plan
- **Related:** [Plan 05 marketplace redesign](./2026-07-20-marketplace-redesign.md) (origin of `EventCard`/`EventRow`) · [Plan 11 event images](./2026-07-21-event-images-design.md) (hero image + `EventGallery` carousel — already shipped; see §0) · [mobile RNR migration](./2026-07-22-mobile-rnr-migration-design.md) (the `components/ui/*` primitives this extends)

## 0. Source list & disposition

The product ask was a list of 10 UI items. Two are already shipped; this plan covers the remaining 8, grouped into 4 workstreams.

| # | Ask | Disposition |
| --- | --- | --- |
| 1 | "+N joined" on event cards | **§2** — mobile `EventCard` |
| 2 | Event date range (admin + mobile), not a fixed date | **§1** — schema + admin editor + mobile |
| 3 | Address on event cards, above the date | **§2** — mobile `EventCard` |
| 4 | Featured image on event cards | **Already shipped** (Plan 11) — `EventCard` renders `hero_image_url` today. No work. |
| 5 | Profile dropdowns positioned right / cut off | **§3** — `align="end"` on Profile's `SelectRow` |
| 6 | Long dropdown lists can't scroll | **§3** — shared `components/ui/select.tsx` fix |
| 7 | Remove bold profile text values | **§3** — `profile.tsx` `RVALUE` style |
| 8 | Pull-to-refresh | **§4** — global `useGlobalRefresh` hook |
| 9 | Home-screen icon from `assets/topnav-logo.png` | **§5** |
| 10 | Carousel on the event page | **Already shipped** (Plan 11) — `EventGallery` on `app/event/[id].tsx`. No work. |

All work lands on a new branch off `main` (not on `main` directly).

## 1. Event date range (schema + admin + mobile)

**Schema** (new additive migration): `alter table events add column end_date date;` — nullable. `null` = single-day event, identical to today's behavior and requiring no backfill.

**`packages/shared`** — one new pure helper, alongside the existing `formatAddress`:

```ts
/** Compose a date range from two ISO dates using the caller's own single-date
 *  formatter, so "same month/year" logic never needs to live in shared code.
 *  No end date, or end === start, collapses to a single formatted date. */
export function formatDateRange(
  startIso: string | null,
  endIso: string | null,
  formatOne: (iso: string) => string
): string {
  if (!startIso) return "";
  if (!endIso || endIso === startIso) return formatOne(startIso);
  return `${formatOne(startIso)} – ${formatOne(endIso)}`;
}
```

Deliberately simple: no "Sep 1–3" same-month elision. Output is e.g. `"Sep 1 – Sep 3"` (mobile card, via `shortDate`) or `"Sep 1, 2026 – Sep 3, 2026"` (mobile detail page / admin table, via `longDate` / admin's `fmtDate`). Both apps keep their own single-date formatter; only the range-composition logic is shared.

**Mobile** (`apps/mobile/lib/events.ts`): `EVENT_COLS` gains `end_date`; `EventRow` gains `end_date: string | null`. `EventCard`'s cancelled-date logic (`` `was ${shortDate(...)}` ``) becomes `` `was ${formatDateRange(event.event_date, event.end_date, shortDate)}` ``. `event/[id].tsx`'s meta line swaps its single `longDate(event.event_date)` for the same range treatment.

**Admin** (`apps/web`):
- `lib/events.ts` (`AdminEventRow`, both select queries) and `lib/eventWrites.ts` (`EventDraft`, `EVENT_COLS`) gain `end_date`.
- `lib/validation.ts`: `eventInputSchema` gains `end_date: dateStr`, plus a `.refine` that `end_date` (if set) is `>= event_date` (if set) — mirrors the existing regex-based `dateStr`.
- `EventEditor.tsx`: add an "END DATE" input next to "DATE" (the `event_date/flag_off/status` grid becomes 4 columns). Optional field.
- `Events.tsx` (admin list): the Date column renders via `formatDateRange(e.event_date, e.end_date, fmtDate)` instead of a single `fmtDate` call.
- `RescheduleModal.tsx` + `rescheduleEvent`: the modal already receives the full `AdminEventRow` (which will include `end_date`); `rescheduleEvent` gains a `currentEndDate` parameter and computes `newEndDate = currentEndDate ? shiftBySameDelta(currentDate, currentEndDate, newDate) : null` (small local date-math helper in `eventWrites.ts`, day-diff + add-days on `YYYY-MM-DD` strings — not pushed to `packages/shared` since mobile never reschedules). The reschedule UI itself is unchanged: one date input, span length preserved automatically.

## 2. Mobile `EventCard`: address, date range, joined count

**Data** (`apps/mobile/lib/events.ts`): `EVENT_COLS` gains a `categories(slots_taken)` join (mirrors the existing `organizations(name,brand_color)` join already on the same query). `EventRow` gains `joined_count: number`; `mapEvent` computes it as `sum(categories[].slots_taken)`. `slots_taken` only increments when a registration reaches `status = 'paid'` (`supabase/functions/_shared/confirm.ts`), so this is paid-only "joined" with no new query, per your answer. Applies to every place `EVENT_COLS` is used (marketplace list, org detail list, single-event fetch) — one change, three surfaces, no duplication.

**`EventCard.tsx`** restructure — today's single combined line (`formatAddress || place` + date joined with " · ") becomes three stacked lines under the title:

1. **Address** — `formatAddress(event) || event.place` (unchanged data, own line, on top — per your answer, "place them with the existing address that's already in the card").
2. **Date range** — `formatDateRange(event.event_date, event.end_date, shortDate)`, with the existing "was …" cancelled-state prefix applied to the whole range.
3. **"+N joined"** — shown only when `joined_count > 0` (a brand-new event shows nothing rather than "+0 joined"), styled as a small muted line consistent with the other two.

No new component — this is a restructure of `EventCard`'s existing meta block, same visual language (muted `13px` text), just three lines instead of one combined string. Reused automatically everywhere `EventCard` is rendered (Events tab, Org detail).

## 3. Dropdown fixes + profile text weight

Root-caused by reading `@rn-primitives/select`'s native source directly (not guessed):

- **Item 6 (long lists can't scroll):** on native, the primitive's `Viewport` is a no-op (`<>{children}</>` — real scrolling only exists in its web build). A long list — PsgcAddressPicker's City picker can run to 100+ entries for a populous province — renders at full height with nothing to scroll. **Fix, in the shared `apps/mobile/components/ui/select.tsx`:** wrap the native `Viewport`'s children in a real, height-bounded `ScrollView` (capped to roughly half the screen height). One change in the shared primitive; every dropdown in the app benefits, including ones added later.
- **Item 5 (right-positioned, cut off):** Profile's compact `SelectRow` trigger sits flush at the right edge of its row. The primitive's positioning math (`getLeftPosition` in `@rn-primitives/hooks`) does clamp the popup to stay on-screen, but the default `align="start"` anchors the popup's *left* edge to the trigger's left edge and grows rightward — from a trigger already near the screen edge, so the clamp forces it into an awkward, visually-disconnected position rather than a clean one. **Fix:** pass `align="end"` on Profile's `SelectRow` `<SelectContent>` usage, so the popup's right edge pins to the trigger's right edge and grows left into the card. Scoped to `profile.tsx` only — `PsgcAddressPicker`'s own triggers are already full-width, not right-anchored, so they only need the §6 scroll fix, not this one.
- Both verified visually in the iOS Simulator against the actual long PSGC city list and a right-edge profile field — positioning math is easy to get subtly wrong on paper.
- **Item 7:** `apps/mobile/app/(tabs)/profile.tsx`'s `RVALUE` constant drops `font-semibold` (`"text-[15px] font-semibold text-foreground"` → `"text-[15px] text-foreground"`). Applies to Full name, Bib name, DOB, Gender, Shirt size, Blood type, Emergency name/phone, and City — the row values built with `RVALUE` (`TextRow`, `SelectRow`, the DOB row). Labels, the header name, BIB badge, and RACES/BLOOD/SHIRT stats are untouched, per your answer.

## 4. Global pull-to-refresh

One new hook, `apps/mobile/lib/useGlobalRefresh.ts`:

```ts
export function useGlobalRefresh() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await qc.refetchQueries({ type: "active" }); }
    finally { setRefreshing(false); }
  }, [qc]);
  return { refreshing, onRefresh };
}
```

`refetchQueries({ type: "active" })` refetches whatever queries are currently mounted — not a hardcoded list of query keys — so any screen adopts pull-to-refresh with the same two lines (`const { refreshing, onRefresh } = useGlobalRefresh()`, spread into a `RefreshControl`), with no per-screen logic to write. That's what makes it "global": one implementation, reused identically everywhere, including screens added after this change.

Wired into all four data screens: `app/(tabs)/events.tsx`, `app/(tabs)/orgs.tsx`, `app/(tabs)/races.tsx` (all `FlatList`, all already React-Query-backed) and `app/(tabs)/profile.tsx` (`ScrollView`).

Profile is the one screen not on React Query today — it loads via a plain `useEffect` + `getProfile(uid)` call. It moves to `useQuery(["profile", uid], () => getProfile(uid), { enabled: !!uid })`, so it participates in the shared refresh mechanism like every other screen. The existing editable-draft state (the form fields, dirty-check against `saved`, the Save button) is unchanged — it's re-seeded from `query.data` the same way it's seeded today, just sourced from a query instead of a one-shot promise.

Note on scope: a pull-down gesture is inherently tied to whichever scrollable view is on screen — there's no OS-level gesture spanning multiple tabs at once. "Global" here means *one reused implementation, no per-screen custom logic* — not a single gesture zone covering every tab simultaneously.

## 5. App icon

`assets/topnav-logo.png` (the real "R" runner mark, ~5083×5050, transparent background) replaces the current placeholder `icon.png` (a generic default-Expo mountain glyph — unrelated to the brand). Generated once during implementation (image compositing, not app code):

- `apps/mobile/assets/icon.png` — 1024×1024, the mark composited onto an **opaque white** square (iOS home-screen icons cannot have transparency).
- `apps/mobile/assets/android-icon-foreground.png` — the mark centered within Android's ~66% adaptive-icon safe zone (this layer *can* stay transparent; Android composites it over the background layer at runtime).
- `apps/mobile/assets/android-icon-background.png` — regenerated as solid white, and `app.json`'s `android.adaptiveIcon.backgroundColor` updated from `#E6F4FE` to `#FFFFFF`, so every Android rendering path (backgroundColor or backgroundImage) agrees.
- `apps/mobile/assets/android-icon-monochrome.png` — regenerated as a single-color silhouette of the mark (Android 13+ themed-icon requirement; the OS applies its own tint).

Out of scope: `splash-icon.png` and the web `favicon.png` are untouched — this is the home-screen icon only, per your ask.

## 6. Edge cases

| Case | Behavior |
| --- | --- |
| Event has no `end_date` | Card/detail/admin all show a single date, byte-identical to today |
| `end_date` equals `event_date` | Treated as single-day (range collapses to one date) |
| Admin sets `end_date` before `event_date` | Rejected client-side by the schema `.refine`, same error-surfacing as other invalid fields |
| Reschedule a single-day event | `end_date` stays `null` (no span to preserve) |
| Reschedule a multi-day event | New `end_date` shifts by the same day-delta as the new start |
| Brand-new event, 0 paid registrations | Card shows no "joined" line at all (not "+0 joined") |
| Event with no categories | `joined_count` sums to 0 → same as above |
| Long PSGC city list (100+ entries) | Scrolls inside the bounded `ScrollView`, same as any native picker |
| Profile Select with nothing selected | `align="end"` positioning applies regardless of value state |
| Pulling to refresh with no network | `refetchQueries` rejects per-query as today; `finally` still clears `refreshing` so the spinner doesn't stick |
| Pulling to refresh on Profile mid-edit (dirty form) | Refetch reseeds `query.data`; unsaved local edits are a pre-existing risk class (same as navigating away today), not newly introduced |

## 7. Testing

- **`packages/shared`:** new unit tests for `formatDateRange` (no end date, end === start, normal range, cross-month, cross-year).
- **Mobile (Jest + RTL), extending existing suites:**
  - `event-card.test.tsx` — three-line meta rendering, joined-count threshold (0 vs >0), date-range display, cancelled "was …" range.
  - `profile.test.tsx` — `RVALUE` no longer bold; `SelectRow` passes `align="end"`; screen still loads/saves via `useQuery`-backed profile data; `RefreshControl` present.
  - `psgc-picker.test.tsx` — long list renders inside a scrollable container.
  - `events-hooks.test.tsx` / `org-page.test.tsx` / `my-races.test.tsx` — `end_date` / `joined_count` pass through the query layer; `RefreshControl` wired on each screen.
  - New `use-global-refresh.test.ts` — `onRefresh` calls `refetchQueries({ type: "active" })` and toggles `refreshing`.
- **Web (Vitest + RTL), extending existing suites:**
  - `event-editor.test.tsx` — END DATE field, validation (`end_date >= event_date`), save round-trip.
  - `events.test.tsx` — Date column renders a range when `end_date` is set.
  - `events-address.test.tsx` — unaffected; confirms address rendering still passes.
  - Reschedule: new coverage that a multi-day event's `end_date` shifts by the same delta as the new start date.
- **Manual (iOS Simulator):** both dropdown fixes against real long-list and right-edge-trigger cases; pull-to-refresh gesture on each of the four screens; the new home-screen icon on-device.

## 8. Out of scope

- Any further work on featured image / carousel (#4, #10) — already shipped.
- Smart date-range formatting (same-month/year elision, e.g. "Sep 1–3").
- Orphaned Storage cleanup, EXIF stripping, drag-to-reorder — unrelated to this batch (tracked, if at all, under Plan 11's own out-of-scope list).
- Splash screen / web favicon rebranding.
- Any change to Plan 14 (race-day check-in) — unstarted, unaffected by this work.

## 9. File touch-list (for writing-plans)

- **Create (backend):** migration `supabase/migrations/<ts>_events_date_range.sql` (`end_date` column, additive).
- **Modify (shared):** `packages/shared/src/index.ts` (+`formatDateRange`), `packages/shared/src/index.test.ts`.
- **Modify (mobile):** `lib/events.ts` (`end_date`, `categories(slots_taken)` join, `joined_count`), `components/EventCard.tsx` (three-line meta), `app/event/[id].tsx` (date-range meta), `components/ui/select.tsx` (bounded native `ScrollView` in `SelectContent`), `app/(tabs)/profile.tsx` (`align="end"`, `RVALUE` weight, `useQuery`-backed profile fetch, `RefreshControl`), `app/(tabs)/events.tsx` / `app/(tabs)/orgs.tsx` / `app/(tabs)/races.tsx` (`RefreshControl`), `app.json` (icon path, adaptive icon background color).
- **Create (mobile):** `lib/useGlobalRefresh.ts` + test; regenerated `assets/icon.png`, `assets/android-icon-foreground.png`, `assets/android-icon-background.png`, `assets/android-icon-monochrome.png`.
- **Modify (web):** `lib/events.ts`, `lib/eventWrites.ts` (`end_date`, reschedule delta-shift), `lib/validation.ts` (schema + refine), `routes/EventEditor.tsx` (END DATE input), `routes/Events.tsx` (range display), `components/RescheduleModal.tsx` (type only — already receives the full row).
- **Docs:** register this plan in `docs/README.md` (unnumbered entry, matching the "Mobile UI → React Native Reusables migration" style) once implemented.
