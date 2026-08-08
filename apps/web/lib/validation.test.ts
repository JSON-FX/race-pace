import { EVENT_DISCIPLINES } from "@race-pace/shared";
import { eventInputSchema, categoryInputSchema, addonInputSchema, scheduleItemSchema, inclusionItemSchema, sanitizeListFields, kitCutoffError, INCLUSION_MAX_LEN } from "./validation";

const validEvent = { name: "Race", city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null, event_date: "2026-10-18", end_date: null, flag_off: "04:00", status: "open", discipline: "trail", registration_closes_at: null, kit_edit_closes_at: null, elevation_gain_m: 4300, cutoff_hours: 18, description: null, hero_image_url: null };

it("accepts a valid event and rejects an empty name / bad date", () => {
  expect(eventInputSchema.safeParse(validEvent).success).toBe(true);
  expect(eventInputSchema.safeParse({ ...validEvent, name: "  " }).success).toBe(false);
  expect(eventInputSchema.safeParse({ ...validEvent, event_date: "10/18/2026" }).success).toBe(false);
});
const validCategory = { code: "21k", label: "21K", distance_km: 21, base_price: 150000, slots_total: 100, elevation_gain_m: null, cutoff_hours: null, blurb: null };

it("category rejects empty code and negative price", () => {
  expect(categoryInputSchema.safeParse(validCategory).success).toBe(true);
  expect(categoryInputSchema.safeParse({ ...validCategory, code: "" }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ ...validCategory, base_price: -1 }).success).toBe(false);
});
it("addon rejects negative price", () => {
  expect(addonInputSchema.safeParse({ name: "Singlet", price: 65000 }).success).toBe(true);
  expect(addonInputSchema.safeParse({ name: "Singlet", price: -5 }).success).toBe(false);
});
it("accepts a gallery array and defaults it when omitted", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, gallery: ["https://cdn/a.png"] }).success).toBe(true);
  expect(eventInputSchema.parse(validEvent).gallery).toEqual([]);
  expect(eventInputSchema.safeParse({ ...validEvent, gallery: [1, 2] }).success).toBe(false);
});
it("accepts structured PSGC + venue fields and rejects a non-string city code", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos", venue: "Camp Sabros" }).success).toBe(true);
  expect(eventInputSchema.safeParse({ ...validEvent, city_psgc_code: 112603 }).success).toBe(false);
});
it("accepts flag_off with or without seconds (Postgres time round-trip) and rejects malformed", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, flag_off: "04:00" }).success).toBe(true);
  expect(eventInputSchema.safeParse({ ...validEvent, flag_off: "04:00:00" }).success).toBe(true);
  expect(eventInputSchema.safeParse({ ...validEvent, flag_off: "4:00" }).success).toBe(false);
});
it("accepts every shared discipline and rejects a value outside the shared list", () => {
  for (const d of EVENT_DISCIPLINES) {
    expect(eventInputSchema.safeParse({ ...validEvent, discipline: d }).success).toBe(true);
  }
  expect(eventInputSchema.safeParse({ ...validEvent, discipline: "triathlon" }).success).toBe(false);
});
it("schedule rows require HH:MM time and a non-empty label; empty schedule is valid", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, schedule: [] }).success).toBe(true);
  expect(eventInputSchema.parse(validEvent).schedule).toEqual([]);
  expect(scheduleItemSchema.safeParse({ time: "04:30", label: "Gun start, 21K and 10K" }).success).toBe(true);
  expect(scheduleItemSchema.safeParse({ time: "4:30", label: "Gun start" }).success).toBe(false);
  expect(scheduleItemSchema.safeParse({ time: "04:30", label: "" }).success).toBe(false);
  expect(eventInputSchema.safeParse({
    ...validEvent,
    schedule: [{ time: "04:30", label: "Gun start" }, { time: "07:00", label: "Cut-off, 10K" }],
  }).success).toBe(true);
});
it("inclusion rows are short, non-blank prose; empty inclusions is valid", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, inclusions: [] }).success).toBe(true);
  expect(eventInputSchema.parse(validEvent).inclusions).toEqual([]);
  expect(inclusionItemSchema.safeParse("Finisher medal and summit certificate").success).toBe(true);
  expect(inclusionItemSchema.safeParse("").success).toBe(false);
  expect(inclusionItemSchema.safeParse("x".repeat(INCLUSION_MAX_LEN)).success).toBe(true);
  expect(inclusionItemSchema.safeParse("x".repeat(INCLUSION_MAX_LEN + 1)).success).toBe(false);
  expect(eventInputSchema.safeParse({
    ...validEvent,
    inclusions: ["Race kit, bib, and timing chip", "Six aid stations with hot food"],
  }).success).toBe(true);
});
it("sanitizeListFields trims text and drops blank schedule/inclusion rows without dropping partial ones", () => {
  const draft = {
    schedule: [
      { time: "  ", label: "  " },              // fully blank -> dropped
      { time: "04:30", label: "  Gun start  " }, // trimmed, kept
      { time: "", label: "Cut-off, 10K" },       // partial -> kept as-is (still invalid, surfaces an error)
    ],
    inclusions: ["  ", "Finisher medal  ", "", "   Six aid stations   "],
  };
  const sanitized = sanitizeListFields(draft);
  expect(sanitized.schedule).toEqual([
    { time: "04:30", label: "Gun start" },
    { time: "", label: "Cut-off, 10K" },
  ]);
  expect(sanitized.inclusions).toEqual(["Finisher medal", "Six aid stations"]);
});
it("sanitizeListFields applied before save means removing every row persists [] rather than null/undefined", () => {
  const sanitized = sanitizeListFields({ schedule: [], inclusions: ["  ", ""] });
  expect(sanitized.inclusions).toEqual([]);
  expect(Array.isArray(sanitized.inclusions)).toBe(true);
});
it("accepts ISO deadline strings and rejects a non-ISO value", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, registration_closes_at: "2026-09-01T23:59:00.000Z", kit_edit_closes_at: "2026-09-06T23:59:00.000Z" }).success).toBe(true);
  expect(eventInputSchema.safeParse({ ...validEvent, registration_closes_at: "2026-09-01" }).success).toBe(false);
});
// Regression: PostgREST serialises `timestamptz` with an explicit offset (`+00:00`), not a
// trailing `Z`, and with microsecond precision. A round trip through getEventForEditor reads
// that shape back — not the `Z`-suffixed, millisecond string fromLocalInput() writes — so a
// fixture built only from fromLocalInput() output can never catch a schema that only accepts
// `Z`. These use literal strings in the exact shape PostgREST actually returns.
it("accepts a PostgREST-shaped offset timestamp with microsecond precision (read-back, not the write shape)", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, registration_closes_at: "2026-08-06T01:07:51.985367+00:00" }).success).toBe(true);
});
it("still accepts the Z-suffixed millisecond form fromLocalInput() writes", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, registration_closes_at: "2026-09-01T15:59:00.000Z" }).success).toBe(true);
});
it("still rejects a bare date with no time component", () => {
  expect(eventInputSchema.safeParse({ ...validEvent, registration_closes_at: "2026-09-01" }).success).toBe(false);
});
it("kitCutoffError mirrors events_kit_edit_after_reg_close: kit cutoff must not be earlier than registration close when both are set", () => {
  expect(kitCutoffError({ registration_closes_at: null, kit_edit_closes_at: null })).toBeNull();
  expect(kitCutoffError({ registration_closes_at: "2026-09-01T00:00:00.000Z", kit_edit_closes_at: null })).toBeNull();
  // The DB CHECK constraint (events_kit_edit_after_reg_close) only fires
  // when BOTH columns are set — a kit-edit cutoff with no registration
  // cutoff at all must be allowed, not flagged.
  expect(kitCutoffError({ registration_closes_at: null, kit_edit_closes_at: "2026-09-06T00:00:00.000Z" })).toBeNull();
  expect(kitCutoffError({ registration_closes_at: "2026-09-06T00:00:00.000Z", kit_edit_closes_at: "2026-09-01T00:00:00.000Z" })).toMatch(/kit edits cannot close before registration/i);
  expect(kitCutoffError({ registration_closes_at: "2026-09-01T00:00:00.000Z", kit_edit_closes_at: "2026-09-06T00:00:00.000Z" })).toBeNull();
});
it("category gain/cutoff are optional and bounded; out-of-range values are rejected", () => {
  expect(categoryInputSchema.safeParse(validCategory).success).toBe(true); // both null is valid
  expect(categoryInputSchema.safeParse({ ...validCategory, elevation_gain_m: 3200, cutoff_hours: 18.5, blurb: "For first-timers" }).success).toBe(true);
  expect(categoryInputSchema.safeParse({ ...validCategory, elevation_gain_m: -1 }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ ...validCategory, elevation_gain_m: 30001 }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ ...validCategory, cutoff_hours: -0.1 }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ ...validCategory, cutoff_hours: 240.1 }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ ...validCategory, cutoff_hours: 18.25 }).success).toBe(false); // more than one decimal
});
