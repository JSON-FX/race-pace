# PSGC Standardized Addresses — Design Spec (data + runner app; admin at M3)

- **Status:** Approved (brainstorm 2026-07-20)
- **Owner:** Product (jayson@voltcontent.com)
- **Feeds:** superpowers:writing-plans → implementation plan
- **Relates to:** event location display from [2026-07-20-marketplace-redesign.md](2026-07-20-marketplace-redesign.md) §3; the Profile screen from [2026-07-20-runner-profile-core-details-design.md](2026-07-20-runner-profile-core-details-design.md)

## 1. Goal

Standardize Philippine addresses to the **Philippine Standard Geographic Code (PSGC)** so users know **exactly** where an event is, and location data is consistent enough for future features (events-near-me, demographics, kit shipping). Today `events.place`/`events.region` and `profiles.city` are free text ("Davao" vs "Davao City" vs "davao"). This effort replaces the display/entry of those with a structured PSGC hierarchy (Region → Province → City/Municipality) plus a free-text venue for events.

**Scope (from brainstorm):** build the PSGC **foundation + mobile** now. The **admin event-creation picker is deferred to the M3 Admin web** (`apps/web` is currently just a README — it does not exist), which will reuse the same `psgc_*` tables and a web port of the picker. Seeded events carry real PSGC codes now so the standardized address is live in-app.

No security-model change beyond adding anon-readable public reference tables.

## 2. Decisions (from brainstorm)

1. **Foundation + mobile now; admin at M3.** No throwaway admin work; the M3 admin consumes the same tables/component.
2. **Depth = City/Municipality + venue text.** PSGC Region → Province → City/Municipality (the standardized dropdowns) + a free-text `venue` line on events (e.g. "Kapatagan Base Camp"). **No barangay level** (avoids importing ~42k rows).
3. **Approach A — Supabase reference tables.** Three tables `psgc_regions / psgc_provinces / psgc_cities` populated by a committed, **regenerable** seed (an import script fetches the API → writes SQL; `supabase db reset` applies it). **No runtime dependency on the community API.** Events/profiles store the leaf `city_psgc_code` (FK) **plus denormalized labels** (`region_name/province_name/city_name`) for join-free display.
4. **`formatAddress` = "City, Province"** (region shown only on the event page's full chip).
5. **Add a `venue` column** to events rather than repurposing `place`; keep legacy `place`/`region`/`city` columns (nullable, unused for display) for safety.
6. **PSGC fields nullable in DB** (migration safety); display falls back to legacy free text when absent; M3 admin enforces required-at-creation.

## 3. PSGC reference tables + import

**Confirmed API shapes** (flat JSON arrays at `https://psgc.gitlab.io/api/{regions,provinces,cities-municipalities}.json`):
- region: `{ code, name, regionName, islandGroupCode, psgc10DigitCode }`
- province: `{ code, name, regionCode, islandGroupCode, psgc10DigitCode }`
- city/municipality: `{ code, name, oldName, isCapital, isCity, isMunicipality, provinceCode, districtCode, regionCode, islandGroupCode, psgc10DigitCode }`

Counts: ~17 regions + ~82 provinces + ~1,600 cities/municipalities ≈ **1,700 rows**.

**Tables** (new migration; codes are text PKs, parent FKs by code):
```sql
create table psgc_regions (
  code text primary key, name text not null,
  region_name text, island_group_code text );

create table psgc_provinces (
  code text primary key, name text not null,
  region_code text not null references psgc_regions(code),
  island_group_code text );

create table psgc_cities (
  code text primary key, name text not null,
  is_city boolean not null default false,
  province_code text references psgc_provinces(code),   -- nullable: NCR / independent cities have none
  region_code text not null references psgc_regions(code),
  island_group_code text );
create index on psgc_provinces(region_code);
create index on psgc_cities(province_code);
create index on psgc_cities(region_code);

alter table psgc_regions   enable row level security;
alter table psgc_provinces enable row level security;
alter table psgc_cities    enable row level security;
create policy "psgc_regions_read"   on psgc_regions   for select using (true);
create policy "psgc_provinces_read" on psgc_provinces for select using (true);
create policy "psgc_cities_read"    on psgc_cities    for select using (true);
```
Public reference data: anon `select` only; no client writes.

**Import script** `scripts/import-psgc.ts` (Node, run manually):
- Fetches the three endpoints.
- Maps: region `code, name, regionName→region_name, islandGroupCode→island_group_code`; province adds `regionCode→region_code`; city maps `isCity→is_city`, `provinceCode→province_code` (**coerce the API's boolean `false` → SQL `null`**), `regionCode→region_code`.
- Emits **idempotent upserts** (`insert … on conflict (code) do update set …`) into a committed SQL file that `supabase db reset` applies.
- **Design commitment:** the data is generated, committed, and regenerable, with **no runtime call to the hobby API**. (Whether that file is a dedicated migration vs a psql-`\i`-included seed is a plan-level detail; either way it applies on `db reset` and re-running the script refreshes it.)
- **Load-ordering constraint:** the `psgc_*` tables must be **created and populated before** any `events`/`profiles` row sets a `city_psgc_code` (FK). So on `db reset`: psgc tables migration → psgc data → then `seed.sql`'s events/profiles. If the psgc data lives in `seed.sql`, its rows must precede the events insert.

## 4. Shared types + address formatting

`packages/shared/src/index.ts`:
```ts
export type PsgcAddress = {
  city_psgc_code: string | null;
  city_name: string | null;
  province_name: string | null;
  region_name: string | null;
};

/** "Digos City, Davao del Sur" — PH short form. Null province → just the city; null city → "". */
export function formatAddress(a: Pick<PsgcAddress, "city_name" | "province_name">): string {
  if (!a.city_name) return "";
  return a.province_name ? `${a.city_name}, ${a.province_name}` : a.city_name;
}
```

## 5. Events: address model + display

**Schema** (migration) — add to `events`:
- `city_psgc_code text references psgc_cities(code)`
- `region_name text`, `province_name text`, `city_name text` (denormalized labels)
- `venue text` (free-text assembly area / start venue)
- Legacy `place`, `region` kept nullable, **unused for display**.

**Display** (mobile) — `EventRow`, `EVENT_COLS`, `mapEvent` gain the new fields:
- **Card** (`EventCard.tsx`): `formatAddress(event) · date` → "Digos City, Davao del Sur · Nov 14", falling back to `event.place` when `city_psgc_code` is null.
- **Event page** (`app/event/[id].tsx`): the `◎` chip shows city · province · region; the **`venue`** renders as its own line (e.g. "🏁 Kapatagan Base Camp") so the exact start point is unmistakable. Falls back to legacy `place`/`region` when absent.

**Seed:** the 5 demo events get real PSGC city codes + a venue (implementer selects appropriate cities from `psgc_cities` after import and uses their real `code` — e.g. Apo Sky Ultra 2026 → a Davao-del-Sur municipality near Mt Apo + "Kapatagan Base Camp"; Bukidnon Highland 50 → Malaybalay City; Davao River Trail 21 → Davao City; etc.).

## 6. Runner profile: PSGC picker

**Schema** (migration) — add to `profiles`:
- `city_psgc_code text references psgc_cities(code)` + denormalized `city_name text`, `province_name text`. Legacy `city` kept nullable, unused going forward.

**Profile screen** (`app/(tabs)/profile.tsx`):
- Replace the free-text **CITY** input with `PsgcAddressPicker` (optional field, like the passport fields).
- `upsertProfile` persists `city_psgc_code + city_name + province_name`.
- The header sub-line shows `formatAddress` (City, Province) instead of the free-text city.
- `Profile` type + `getProfile` select gain the new fields.

## 7. The `PsgcAddressPicker` component

New `apps/mobile/components/PsgcAddressPicker.tsx`, backed by `apps/mobile/lib/psgc.ts` query helpers:
```ts
export function usePsgcRegions(): ...;                       // select * from psgc_regions order by name
export function usePsgcProvinces(regionCode?: string): ...;  // where region_code = ? order by name
export function usePsgcCities(opts: { provinceCode?: string; regionCode?: string; search?: string }): ...;
```
(each a Supabase select filtered by parent, TanStack-cached).

**Behavior:**
- Three dependent steps: **Region** (~17, tappable list) → **Province** (~82 filtered by region, tappable list) → **City/Municipality** (~1,600 filtered by province, **searchable** typeahead — `ilike` filter).
- Collapsed state shows the current pick as "City, Province" with an edit affordance; opening it runs the cascade.
- On final city select, emits `{ city_psgc_code, city_name, province_name, region_name }` (full denormalized `PsgcAddress`).
- **NCR / no-province regions:** if the province query for a region returns zero rows, the picker **skips province** and lists cities by `region_code` directly (handles `province_code: null` from §3).

**Props (interface for consumers):**
```ts
function PsgcAddressPicker(props: {
  value: PsgcAddress | null;
  onChange: (a: PsgcAddress) => void;
  label?: string;
}): JSX.Element
```

## 8. Edge cases & error handling

| Case | Behavior |
| --- | --- |
| NCR / independent city (no province) | `province_code` null; picker lists cities by region; `formatAddress` → "City" (event page chip may add region) |
| Legacy record without PSGC code | Display falls back to `place`/`region` (events) or `city` (profile) |
| API `provinceCode: false` / `districtCode: false` | Import coerces to SQL `null` |
| Import API unreachable | Script fails loudly (manual re-run); never affects runtime |
| Picker query fails / offline | Retry/empty state; address-picking is online-only (acceptable — unlike tickets) |
| City search | Case-insensitive `ilike` |
| Re-sync (quarterly) | Idempotent upserts; a renamed/moved place updates on re-run; denormalized labels on existing events remain as historical snapshots |

## 9. Testing

- **Shared unit:** `formatAddress` (City+Province; null province → City; null city → "").
- **Import script unit:** field mapping — region/province/city maps; `provinceCode:false → null`; `isCity` boolean; a spot-checked known record (e.g. a Davao-del-Sur municipality) resolves its parents.
- **`lib/psgc` hooks + `PsgcAddressPicker`:** region→province→city cascade; city search filters; final select emits the `PsgcAddress`; NCR region (no provinces) → cities directly.
- **Event display:** card renders `formatAddress` + falls back to `place`; event page renders the address chip + venue line.
- **Profile:** picker replaces the city field; save persists code + labels; display shows `formatAddress`.
- **Backend (root Vitest):** `psgc_*` tables seeded (counts > 0; a known city code resolves to its province + region); anon can `select` all three (RLS); seeded events carry `city_psgc_code`.

## 10. Out of scope (future)

- **Barangay** level (would add ~42k rows + a 4th cascade step).
- **Lat/long + map pins**, reverse geocoding, "events near me" distance (need coordinates).
- **M3 Admin web** event-creation picker — reuses `psgc_*` tables + a web port of `PsgcAddressPicker`, and enforces required-at-creation.
- Migrating existing free-text `place`/`region`/`city` data (no real data yet; the seed is rewritten).

## 11. File touch-list (for writing-plans)

- **Create:** migration for `psgc_*` tables + RLS · `scripts/import-psgc.ts` · the generated PSGC data seed · `apps/mobile/lib/psgc.ts` · `apps/mobile/components/PsgcAddressPicker.tsx`
- **Modify:** `packages/shared/src/index.ts` (`PsgcAddress`, `formatAddress`) + `packages/shared/src/index.test.ts` · events migration (`city_psgc_code`, labels, `venue`) · profiles migration (`city_psgc_code`, labels) · `supabase/seed.sql` (events get PSGC + venue) · `apps/mobile/lib/events.ts` (`EventRow`/`EVENT_COLS`/`mapEvent`) · `apps/mobile/components/EventCard.tsx` · `apps/mobile/app/event/[id].tsx` · `apps/mobile/lib/profile.ts` (`Profile`/`getProfile`/`upsertProfile`) · `apps/mobile/app/(tabs)/profile.tsx`
- **Tests:** shared `formatAddress` · import-script mapping · `lib/psgc` hooks · `PsgcAddressPicker` · event display · profile picker · backend `psgc_*` seed + RLS
