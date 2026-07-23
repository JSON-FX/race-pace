import { eventInputSchema, categoryInputSchema, addonInputSchema } from "../lib/validation";

const validEvent = { name: "Race", city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null, event_date: "2026-10-18", end_date: null, flag_off: "04:00", status: "open", elevation_gain_m: 4300, cutoff_hours: 18, description: null, hero_image_url: null };

it("accepts a valid event and rejects an empty name / bad date", () => {
  expect(eventInputSchema.safeParse(validEvent).success).toBe(true);
  expect(eventInputSchema.safeParse({ ...validEvent, name: "  " }).success).toBe(false);
  expect(eventInputSchema.safeParse({ ...validEvent, event_date: "10/18/2026" }).success).toBe(false);
});
it("category rejects empty code and negative price", () => {
  expect(categoryInputSchema.safeParse({ code: "21k", label: "21K", distance_km: 21, base_price: 150000, slots_total: 100 }).success).toBe(true);
  expect(categoryInputSchema.safeParse({ code: "", label: "21K", distance_km: null, base_price: 150000, slots_total: 100 }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ code: "21k", label: "21K", distance_km: null, base_price: -1, slots_total: 100 }).success).toBe(false);
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
