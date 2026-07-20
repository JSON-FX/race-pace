import { eventInputSchema, categoryInputSchema, addonInputSchema } from "../lib/validation";

const validEvent = { name: "Race", place: null, region: null, event_date: "2026-10-18", flag_off: "04:00", status: "open", elevation_gain_m: 4300, cutoff_hours: 18, description: null, hero_image_url: null };

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
