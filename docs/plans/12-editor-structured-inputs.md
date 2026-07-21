# Editor Structured Inputs Implementation Plan (Plan 12; M3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin event editor's free-text PLACE/REGION and plain-text DATE/FLAG-OFF fields with structured inputs — cascading PSGC Region→Province→City dropdowns + a Venue field, and native date/time inputs.

**Architecture:** Web-only. Port the mobile PSGC query hooks to `apps/web`, build a `PsgcAddressField` from three cascading native `<select>`s, and thread the existing (already-in-DB) structured columns through the editor's write/read/validation layers exactly as `gallery` was threaded in Plan 11. Reuses the `psgc_*` reference tables (already `select`-readable by `authenticated`) and the `events` PSGC + `venue` columns (already exist from Plan 8). **No schema, migration, RLS, backend, or mobile change.**

**Tech Stack:** Vite 6 / React 19 / supabase-js / TanStack Query v5 / Vitest + RTL (jsdom). `@race-pace/shared` `PsgcAddress` type + `formatAddress`.

**Spec:** [docs/specs/2026-07-21-editor-structured-inputs-design.md](../specs/2026-07-21-editor-structured-inputs-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **PSGC depth is Region → Province → City/Municipality — NO barangay.**
- **Reuse the shared address shape:** `PsgcAddress = { city_psgc_code, city_name, province_name, region_name }` (all `string | null`) from `@race-pace/shared`; the field's `onChange` emits exactly this. `venue` is a separate free-text field.
- **Cascading native `<select>`s** (not a ported drill-down). Region enables Province; Province enables City. A region with **no provinces** (NCR) disables/skips Province and filters City by `region_code`.
- **Native date/time inputs:** `<input type="date">` (native value `YYYY-MM-DD`, matches `events.event_date`) and `<input type="time">` (native value `HH:MM`, matches `events.flag_off`). Keep the existing `aria-label`s `"Date"` and `"Flag-off"`.
- **Legacy `place`/`region` are retired from the editor** (removed from `EventDraft`/`EditorEvent`/`eventInputSchema`/the editor UI and its `select`s) but **kept in the DB** — do NOT drop the columns or write them from the editor. `AdminEventRow` KEEPS `place` for the list's fallback display.
- **Structured columns threaded through the editor:** `city_psgc_code`, `region_name`, `province_name`, `city_name`, `venue` (all `string | null`). Address is **optional** (all nullable).
- **`psgc_*` tables** are `select using (true)` + granted to `authenticated` — no auth/RLS work. `psgc_cities.province_code` is **nullable** (NCR); `region_code` is `not null`.
- **No new dependency** (supabase-js + TanStack Query already in `apps/web`), so **no `docker compose restart web`** is needed.
- **Test commands:** web `pnpm --filter web exec vitest run src/__tests__/<file>`; full web `pnpm --filter web test`; typecheck `pnpm --filter web typecheck`. `apps/mobile` is not touched.

---

### Task 1: Web PSGC data hooks

**Files:**
- Create: `apps/web/src/lib/psgc.ts`
- Test: `apps/web/src/__tests__/psgc-hooks.test.tsx`

**Interfaces:**
- Consumes: `supabase` from `apps/web/src/lib/supabase.ts`; the `psgc_regions/provinces/cities` tables.
- Produces:
  - `type PsgcRow = { code: string; name: string }`
  - `type PsgcCity = { code: string; name: string; province_code: string | null; region_code: string }`
  - `usePsgcRegions()` → `PsgcRow[]`
  - `usePsgcProvinces(regionCode?: string)` → `PsgcRow[]` (disabled without `regionCode`)
  - `usePsgcCities({ provinceCode?, regionCode? })` → `PsgcRow[]` (filters by `province_code`, else `region_code`; disabled without either)
  - `usePsgcCity(code?: string)` → `PsgcCity | null` (for edit-seed; disabled without `code`)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/psgc-hooks.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const eq = vi.fn();
vi.mock("../lib/supabase", () => {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.eq = (...a: unknown[]) => { eq(...a); return b; };
  b.order = () => Promise.resolve({ data: [{ code: "x", name: "X" }], error: null });
  b.maybeSingle = () => Promise.resolve({ data: { code: "c", name: "C", province_code: "p", region_code: "r" }, error: null });
  return { supabase: { from: vi.fn(() => b) } };
});

import { usePsgcProvinces, usePsgcCities, usePsgcCity } from "../lib/psgc";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => eq.mockClear());

it("usePsgcProvinces filters by region_code", async () => {
  const { result } = renderHook(() => usePsgcProvinces("130000000"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toEqual([{ code: "x", name: "X" }]));
  expect(eq).toHaveBeenCalledWith("region_code", "130000000");
});

it("usePsgcCities prefers province_code over region_code", async () => {
  const { result } = renderHook(() => usePsgcCities({ provinceCode: "1324", regionCode: "13" }), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toEqual([{ code: "x", name: "X" }]));
  expect(eq).toHaveBeenCalledWith("province_code", "1324");
  expect(eq).not.toHaveBeenCalledWith("region_code", "13");
});

it("usePsgcCity fetches the single city row for edit-seed", async () => {
  const { result } = renderHook(() => usePsgcCity("112603"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toEqual({ code: "c", name: "C", province_code: "p", region_code: "r" }));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/__tests__/psgc-hooks.test.tsx`
Expected: FAIL — cannot resolve `../lib/psgc`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/psgc.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type PsgcRow = { code: string; name: string };
export type PsgcCity = { code: string; name: string; province_code: string | null; region_code: string };

export function usePsgcRegions() {
  return useQuery({ queryKey: ["psgc-regions"], queryFn: async (): Promise<PsgcRow[]> => {
    const { data, error } = await supabase.from("psgc_regions").select("code,name").order("name");
    if (error) throw error; return (data ?? []) as PsgcRow[];
  } });
}

export function usePsgcProvinces(regionCode?: string) {
  return useQuery({ queryKey: ["psgc-provinces", regionCode], enabled: !!regionCode, queryFn: async (): Promise<PsgcRow[]> => {
    const { data, error } = await supabase.from("psgc_provinces").select("code,name").eq("region_code", regionCode!).order("name");
    if (error) throw error; return (data ?? []) as PsgcRow[];
  } });
}

export function usePsgcCities({ provinceCode, regionCode }: { provinceCode?: string; regionCode?: string }) {
  return useQuery({ queryKey: ["psgc-cities", provinceCode, regionCode], enabled: !!(provinceCode || regionCode), queryFn: async (): Promise<PsgcRow[]> => {
    let q = supabase.from("psgc_cities").select("code,name");
    if (provinceCode) q = q.eq("province_code", provinceCode);
    else if (regionCode) q = q.eq("region_code", regionCode);
    const { data, error } = await q.order("name");
    if (error) throw error; return (data ?? []) as PsgcRow[];
  } });
}

export function usePsgcCity(code?: string) {
  return useQuery({ queryKey: ["psgc-city", code], enabled: !!code, queryFn: async (): Promise<PsgcCity | null> => {
    const { data, error } = await supabase.from("psgc_cities").select("code,name,province_code,region_code").eq("code", code!).maybeSingle();
    if (error) throw error; return (data ?? null) as PsgcCity | null;
  } });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/__tests__/psgc-hooks.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/psgc.ts apps/web/src/__tests__/psgc-hooks.test.tsx
git commit -m "feat(web): PSGC query hooks (regions/provinces/cities + single-city lookup)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: PsgcAddressField component

**Files:**
- Create: `apps/web/src/components/PsgcAddressField.tsx`
- Test: `apps/web/src/__tests__/psgc-address-field.test.tsx`

**Interfaces:**
- Consumes: the Task 1 hooks (mocked in the test); `PsgcAddress` from `@race-pace/shared`.
- Produces: `PsgcAddressField({ value: PsgcAddress | null; onChange: (a: PsgcAddress) => void })` — three cascading selects (`aria-label` `"Region"` / `"Province"` / `"City"`) that emit a full `PsgcAddress` on each change (partial as you go).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/psgc-address-field.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { PsgcAddressField } from "../components/PsgcAddressField";

let provinces: { data: { code: string; name: string }[]; isSuccess: boolean };
let cityLookup: { data: { code: string; name: string; province_code: string | null; region_code: string } | null };
vi.mock("../lib/psgc", () => ({
  usePsgcRegions: () => ({ data: [{ code: "13", name: "Davao Region" }] }),
  usePsgcProvinces: () => provinces,
  usePsgcCities: () => ({ data: [{ code: "112603", name: "City of Digos" }] }),
  usePsgcCity: () => cityLookup,
}));

beforeEach(() => {
  provinces = { data: [{ code: "1324", name: "Davao del Sur" }], isSuccess: true };
  cityLookup = { data: null };
});

it("cascades region → province → city and emits the address progressively", () => {
  const onChange = vi.fn();
  render(<PsgcAddressField value={null} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Region"), { target: { value: "13" } });
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: null, city_name: null, province_name: null, region_name: "Davao Region" });
  fireEvent.change(screen.getByLabelText("Province"), { target: { value: "1324" } });
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: null, city_name: null, province_name: "Davao del Sur", region_name: "Davao Region" });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "112603" } });
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: "112603", city_name: "City of Digos", province_name: "Davao del Sur", region_name: "Davao Region" });
});

it("skips province for a region with no provinces and filters city by region", () => {
  provinces = { data: [], isSuccess: true };
  const onChange = vi.fn();
  render(<PsgcAddressField value={null} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Region"), { target: { value: "13" } });
  expect(screen.getByLabelText("Province")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "112603" } });
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: "112603", city_name: "City of Digos", province_name: null, region_name: "Davao Region" });
});

it("pre-selects region/province/city from a stored city code (edit-seed)", () => {
  cityLookup = { data: { code: "112603", name: "City of Digos", province_code: "1324", region_code: "13" } };
  render(<PsgcAddressField value={{ city_psgc_code: "112603", city_name: "City of Digos", province_name: "Davao del Sur", region_name: "Davao Region" }} onChange={vi.fn()} />);
  expect((screen.getByLabelText("Region") as HTMLSelectElement).value).toBe("13");
  expect((screen.getByLabelText("Province") as HTMLSelectElement).value).toBe("1324");
  expect((screen.getByLabelText("City") as HTMLSelectElement).value).toBe("112603");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/__tests__/psgc-address-field.test.tsx`
Expected: FAIL — cannot resolve `../components/PsgcAddressField`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/PsgcAddressField.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { PsgcAddress } from "@race-pace/shared";
import { usePsgcRegions, usePsgcProvinces, usePsgcCities, usePsgcCity } from "../lib/psgc";

const label = { display: "block", fontSize: 11, fontWeight: 600, letterSpacing: ".4px", color: "var(--ink-muted)", marginBottom: 6 } as const;
const input = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 11, padding: "12px 13px", color: "var(--ink)", fontSize: 14, width: "100%" } as const;

/** Cascading Region → Province → City selects. Emits a full PsgcAddress on each
 *  change (partial until a city is chosen). NCR-style regions with no provinces
 *  skip the Province step and filter cities by region. */
export function PsgcAddressField({ value, onChange }: { value: PsgcAddress | null; onChange: (a: PsgcAddress) => void }) {
  const [regionCode, setRegionCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const seeded = useRef(false);

  const regions = usePsgcRegions();
  const provinces = usePsgcProvinces(regionCode || undefined);
  const noProvinces = !!regionCode && provinces.isSuccess && (provinces.data?.length ?? 0) === 0;
  const cities = usePsgcCities({ provinceCode: provinceCode || undefined, regionCode: noProvinces ? regionCode : undefined });
  const seedCity = usePsgcCity(value?.city_psgc_code || undefined);

  // Edit-seed: recover region/province codes from the stored city code, once.
  useEffect(() => {
    if (!seeded.current && value?.city_psgc_code && seedCity.data) {
      seeded.current = true;
      setRegionCode(seedCity.data.region_code);
      setProvinceCode(seedCity.data.province_code ?? "");
    }
  }, [value?.city_psgc_code, seedCity.data]);

  const nameOf = (rows: { code: string; name: string }[] | undefined, code: string) => (rows ?? []).find((r) => r.code === code)?.name ?? null;
  const regionName = nameOf(regions.data, regionCode) ?? value?.region_name ?? null;
  const provinceName = nameOf(provinces.data, provinceCode) ?? value?.province_name ?? null;

  function pickRegion(code: string) {
    setRegionCode(code); setProvinceCode("");
    onChange({ city_psgc_code: null, city_name: null, province_name: null, region_name: code ? nameOf(regions.data, code) : null });
  }
  function pickProvince(code: string) {
    setProvinceCode(code);
    onChange({ city_psgc_code: null, city_name: null, province_name: code ? nameOf(provinces.data, code) : null, region_name: regionName });
  }
  function pickCity(code: string) {
    onChange({ city_psgc_code: code || null, city_name: code ? nameOf(cities.data, code) : null, province_name: provinceName, region_name: regionName });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      <div>
        <span style={label}>REGION</span>
        <select aria-label="Region" style={input} value={regionCode} onChange={(e) => pickRegion(e.target.value)}>
          <option value="">— Select —</option>
          {(regions.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
      </div>
      <div>
        <span style={label}>PROVINCE</span>
        <select aria-label="Province" style={input} value={provinceCode} disabled={!regionCode || noProvinces} onChange={(e) => pickProvince(e.target.value)}>
          <option value="">{noProvinces ? "— None —" : "— Select —"}</option>
          {(provinces.data ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <span style={label}>CITY / MUNICIPALITY</span>
        <select aria-label="City" style={input} value={value?.city_psgc_code ?? ""} disabled={!(provinceCode || noProvinces)} onChange={(e) => pickCity(e.target.value)}>
          <option value="">— Select —</option>
          {(cities.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/__tests__/psgc-address-field.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PsgcAddressField.tsx apps/web/src/__tests__/psgc-address-field.test.tsx
git commit -m "feat(web): PsgcAddressField — cascading Region/Province/City selects with edit-seed" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Thread PSGC + venue through the editor; swap inputs

**Files:**
- Modify: `apps/web/src/lib/eventWrites.ts` (`EventDraft` + `EVENT_COLS`)
- Modify: `apps/web/src/lib/events.ts` (`EditorEvent` + editor `select`; `AdminEventRow` + `useOrgEvents` `select`)
- Modify: `apps/web/src/lib/validation.ts` (`eventInputSchema`)
- Modify: `apps/web/src/routes/EventEditor.tsx` (blank, PsgcAddressField + Venue, date/time inputs)
- Test: `apps/web/src/__tests__/validation.test.ts` (update), `apps/web/src/__tests__/event-editor.test.tsx` (update)

**Interfaces:**
- Consumes: `PsgcAddressField` (Task 2), `PsgcAddress` shape.
- Produces: `EventDraft`/`EditorEvent` carry `city_psgc_code`/`region_name`/`province_name`/`city_name`/`venue` (and no longer `place`/`region`); `AdminEventRow` gains `city_name`/`province_name` (keeps `place`).

- [ ] **Step 1: Swap the columns in the data + validation layers**

In `apps/web/src/lib/eventWrites.ts`, replace `place`/`region` in `EventDraft` and `EVENT_COLS`:

```ts
export type EventDraft = {
  id?: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  event_date: string | null; flag_off: string | null; status: string;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  hero_image_url: string | null; gallery: string[];
};
```

```ts
const EVENT_COLS = (e: EventDraft) => ({
  org_id: e.org_id, name: e.name,
  city_psgc_code: e.city_psgc_code, region_name: e.region_name, province_name: e.province_name, city_name: e.city_name, venue: e.venue,
  event_date: e.event_date, flag_off: e.flag_off, status: e.status,
  elevation_gain_m: e.elevation_gain_m, cutoff_hours: e.cutoff_hours,
  description: e.description, hero_image_url: e.hero_image_url, gallery: e.gallery,
});
```

In `apps/web/src/lib/events.ts`:

Replace `place`/`region` in `EditorEvent`:

```ts
export type EditorEvent = {
  id: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  event_date: string | null; flag_off: string | null; status: string;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  hero_image_url: string | null; gallery: string[];
};
```

Update the editor-load `select` (drop `place,region`, add the 5):

```ts
      const ev = await supabase.from("events")
        .select("id,org_id,name,city_psgc_code,region_name,province_name,city_name,venue,event_date,flag_off,status,elevation_gain_m,cutoff_hours,description,hero_image_url,gallery")
        .eq("id", id!).single();
```

Add `city_name`/`province_name` to `AdminEventRow` (keep `place`) and its `select`:

```ts
export type AdminEventRow = {
  id: string;
  name: string;
  place: string | null;
  city_name: string | null;
  province_name: string | null;
  event_date: string | null;
  status: string;
  original_date: string | null;
  categories: { slots_taken: number; slots_total: number }[];
};
```

```ts
        .select("id,name,place,city_name,province_name,event_date,status,original_date,categories(slots_taken,slots_total)")
```

In `apps/web/src/lib/validation.ts`, replace `place`/`region` in `eventInputSchema`:

```ts
export const eventInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  city_psgc_code: z.string().nullable(),
  region_name: z.string().nullable(),
  province_name: z.string().nullable(),
  city_name: z.string().nullable(),
  venue: z.string().nullable(),
  event_date: dateStr,
  flag_off: timeStr,
  status: z.enum(EVENT_STATUSES),
  elevation_gain_m: intNonNeg.nullable(),
  cutoff_hours: intNonNeg.nullable(),
  description: z.string().nullable(),
  hero_image_url: z.string().nullable(),
  gallery: z.array(z.string()).default([]),
});
```

- [ ] **Step 2: Update the validation test (RED → GREEN on validation)**

In `apps/web/src/__tests__/validation.test.ts`, update the `validEvent` fixture (drop `place`/`region`, add the 5 PSGC/venue fields) and add a case:

```ts
const validEvent = { name: "Race", city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null, event_date: "2026-10-18", flag_off: "04:00", status: "open", elevation_gain_m: 4300, cutoff_hours: 18, description: null, hero_image_url: null };
```

Add after the existing gallery test:

```ts
it("accepts structured PSGC + venue fields and rejects a non-string city code", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos", venue: "Camp Sabros" }).success).toBe(true);
  expect(eventInputSchema.safeParse({ ...validEvent, city_psgc_code: 112603 }).success).toBe(false);
});
```

Run: `pnpm --filter web exec vitest run src/__tests__/validation.test.ts`
Expected: PASS.

- [ ] **Step 3: Swap the editor inputs**

In `apps/web/src/routes/EventEditor.tsx`:

(a) Add the import:

```ts
import { PsgcAddressField } from "../components/PsgcAddressField";
```

(b) Replace `place`/`region` in the `blank` default with the 5 fields:

```ts
const blank: EventDraft = { org_id: "", name: "", city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null, event_date: null, flag_off: null, status: "draft", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [] };
```

(c) Replace the PLACE/REGION grid:

```tsx
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><span style={label}>PLACE</span><input aria-label="Place" style={input} value={event.place ?? ""} onChange={(e) => set({ place: e.target.value || null })} /></div>
              <div><span style={label}>REGION</span><input aria-label="Region" style={input} value={event.region ?? ""} onChange={(e) => set({ region: e.target.value || null })} /></div>
            </div>
```

with the PSGC field + a Venue input:

```tsx
            <PsgcAddressField
              value={{ city_psgc_code: event.city_psgc_code, city_name: event.city_name, province_name: event.province_name, region_name: event.region_name }}
              onChange={(a) => set(a)}
            />
            <div><span style={label}>VENUE</span><input aria-label="Venue" style={input} value={event.venue ?? ""} onChange={(e) => set({ venue: e.target.value || null })} /></div>
```

(d) Change the DATE input to `type="date"` (drop the placeholder):

```tsx
              <div><span style={label}>DATE</span><input aria-label="Date" placeholder="YYYY-MM-DD" style={input} value={event.event_date ?? ""} onChange={(e) => set({ event_date: e.target.value || null })} /></div>
```

becomes:

```tsx
              <div><span style={label}>DATE</span><input aria-label="Date" type="date" style={input} value={event.event_date ?? ""} onChange={(e) => set({ event_date: e.target.value || null })} /></div>
```

(e) Change the FLAG-OFF input to `type="time"` (drop the placeholder):

```tsx
              <div><span style={label}>FLAG-OFF</span><input aria-label="Flag-off" placeholder="HH:MM" style={input} value={event.flag_off ?? ""} onChange={(e) => set({ flag_off: e.target.value || null })} /></div>
```

becomes:

```tsx
              <div><span style={label}>FLAG-OFF</span><input aria-label="Flag-off" type="time" style={input} value={event.flag_off ?? ""} onChange={(e) => set({ flag_off: e.target.value || null })} /></div>
```

- [ ] **Step 4: Update the editor test (mock PSGC hooks, fix fixtures, add carry-through)**

In `apps/web/src/__tests__/event-editor.test.tsx`:

(a) Add a PSGC mock next to the other `vi.mock` calls (so `PsgcAddressField` renders without hitting supabase):

```ts
vi.mock("../lib/psgc", () => ({
  usePsgcRegions: () => ({ data: [] }),
  usePsgcProvinces: () => ({ data: [], isSuccess: true }),
  usePsgcCities: () => ({ data: [] }),
  usePsgcCity: () => ({ data: null }),
}));
```

(b) In BOTH `mockUseEventForEditor` fixtures (the "cancelled" test and the "carries hero_image_url + gallery" test), replace `place: null, region: null,` with the 5 fields:

```ts
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
```

(c) Append a new test:

```tsx
it("carries PSGC address + venue + date/time through to save", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos", venue: "Camp Sabros",
        event_date: "2026-11-14", flag_off: "04:00", status: "open",
        elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  // structured inputs replaced the free-text place/region + text date/time
  expect(await screen.findByLabelText("Region")).toBeInTheDocument();
  expect(screen.getByLabelText("Venue")).toBeInTheDocument();
  expect((screen.getByLabelText("Date") as HTMLInputElement).type).toBe("date");
  expect((screen.getByLabelText("Flag-off") as HTMLInputElement).type).toBe("time");
  expect(screen.queryByLabelText("Place")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event).toMatchObject({
    city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos",
    venue: "Camp Sabros", event_date: "2026-11-14", flag_off: "04:00",
  });
});
```

- [ ] **Step 5: Run web tests + typecheck**

Run: `pnpm --filter web exec vitest run src/__tests__/event-editor.test.tsx src/__tests__/validation.test.ts`
Expected: PASS.

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/eventWrites.ts apps/web/src/lib/events.ts apps/web/src/lib/validation.ts apps/web/src/routes/EventEditor.tsx apps/web/src/__tests__/validation.test.ts apps/web/src/__tests__/event-editor.test.tsx
git commit -m "feat(web): structured PSGC address + venue + native date/time inputs in the event editor" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Events list shows the PSGC location

**Files:**
- Modify: `apps/web/src/routes/Events.tsx`
- Test: `apps/web/src/__tests__/events-address.test.tsx`

**Interfaces:**
- Consumes: `AdminEventRow.city_name`/`province_name` (added in Task 3) + `formatAddress` from `@race-pace/shared`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/events-address.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Events } from "../routes/Events";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
const rows = [
  { id: "e1", name: "Apo Sky Ultra", place: null, city_name: "City of Digos", province_name: "Davao del Sur", event_date: "2026-11-14", status: "open", original_date: null, categories: [] },
  { id: "e2", name: "Legacy Race", place: "Mt Apo", city_name: null, province_name: null, event_date: "2026-10-01", status: "open", original_date: null, categories: [] },
];
vi.mock("../lib/events", () => ({ useOrgEvents: () => ({ data: rows, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig()), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

it("shows the PSGC city for a structured row and the legacy place as fallback", () => {
  render(<MemoryRouter><Events /></MemoryRouter>);
  expect(screen.getByText("City of Digos, Davao del Sur")).toBeInTheDocument();
  expect(screen.getByText("Mt Apo")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/__tests__/events-address.test.tsx`
Expected: FAIL — the row still renders `e.place` (null for the structured row), so "City of Digos, Davao del Sur" is not found.

- [ ] **Step 3: Implement the display change**

In `apps/web/src/routes/Events.tsx`, add the import:

```ts
import { formatAddress } from "@race-pace/shared";
```

Replace the place line:

```tsx
                {e.place ? <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{e.place}</div> : null}
```

with a PSGC-first location (falls back to legacy `place`):

```tsx
                {(formatAddress({ city_name: e.city_name, province_name: e.province_name }) || e.place) ? (
                  <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{formatAddress({ city_name: e.city_name, province_name: e.province_name }) || e.place}</div>
                ) : null}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/__tests__/events-address.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/Events.tsx apps/web/src/__tests__/events-address.test.tsx
git commit -m "feat(web): Events list shows PSGC city (falls back to legacy place)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full verification + roadmap

**Files:**
- Modify: `docs/README.md`

- [ ] **Step 1: Run the web suite + typecheck**

```bash
pnpm --filter web test          # all web tests
pnpm --filter web typecheck     # clean
```

Expected: all green. (No backend/mobile change this plan; those suites are untouched.)

- [ ] **Step 2: Update the roadmap (renumber the collision)**

The Plan 11 roadmap edit put "Plan 12 · Registrations & payments" in the slot this plan takes. In `docs/README.md`, replace the M3 roadmap block:

```markdown
- [ ] **Plan 12 · Registrations & payments** — table/detail, admin refunds
- [ ] **Plan 13 · Race-day check-in** — web QR scanner + manual lookup
- [ ] **Plan 14 · Settings + Dashboard** — org settings, KPIs/charts
- [ ] **Plan 15 · super_admin** — org provisioning, commission, payout statements
```

with (this plan inserted as Plan 12; the rest bumped to 13–16):

```markdown
- [x] **Plan 12 · Editor structured inputs** — [plan](./plans/12-editor-structured-inputs.md) — PSGC Region→Province→City pickers + Venue, native date/time inputs (web)
- [ ] **Plan 13 · Registrations & payments** — table/detail, admin refunds
- [ ] **Plan 14 · Race-day check-in** — web QR scanner + manual lookup
- [ ] **Plan 15 · Settings + Dashboard** — org settings, KPIs/charts
- [ ] **Plan 16 · super_admin** — org provisioning, commission, payout statements
```

- [ ] **Step 3: Commit**

```bash
git add docs/README.md
git commit -m "docs: add Plan 12 (editor structured inputs) to the roadmap; renumber 13-16" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual smoke (optional, recommended)**

Open https://admin.racepace.lan → Events → Create/Edit: pick Region → Province → City, set a Venue, use the date and time pickers, Save. Confirm the Events list shows the city. (No `docker compose restart web` needed — no new dependency.)

---

## Self-Review

**Spec coverage:**
- PSGC hooks (web) → Task 1. ✓
- Cascading `PsgcAddressField` + NCR + edit-seed → Task 2. ✓
- Thread `city_psgc_code`/`region_name`/`province_name`/`city_name`/`venue`; retire `place`/`region` from the editor; native date/time inputs → Task 3. ✓
- Events list shows `formatAddress` (fallback to `place`) → Task 4. ✓
- No schema/RLS/backend/mobile change; address optional; no barangay → honored across all tasks (only `apps/web` + `docs` touched). ✓
- Roadmap + verification → Task 5 (also fixes the Plan-11 renumber collision). ✓

**Placeholder scan:** none — every code/test block is complete.

**Type consistency:** `PsgcAddress = { city_psgc_code, city_name, province_name, region_name }` (Task 2 emit) is assignable to `Partial<EventDraft>` because Task 3 adds those exact 4 fields (plus `venue`) to `EventDraft`; `onChange={(a) => set(a)}` therefore typechecks. `EditorEvent`/`EventDraft` both drop `place`/`region` and add the same 5 fields, so the editor's `setEvent({ ...d.event })` seed stays type-compatible. `AdminEventRow` keeps `place` and adds `city_name`/`province_name`, matching both the `useOrgEvents` `select` (Task 3) and the Events list consumer (Task 4). The date/time inputs keep the `event_date` (`YYYY-MM-DD`) / `flag_off` (`HH:MM`) shapes the `dateStr`/`timeStr` validators already enforce.
