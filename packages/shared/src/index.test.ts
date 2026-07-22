import { describe, it, expect } from "vitest";
import {
  customDataSchema, formatPeso, formatAddress, formatDateRange, registrationInputSchema, type FormField,
  PROFILE_KEYS, isProfileKey, BLOOD_TYPES, SHIRT_SIZES, GENDERS,
} from "./index";

describe("customDataSchema", () => {
  const fields: FormField[] = [
    { key: "blood_type", label: "Blood type", type: "select", required: true, options: ["A", "O"] },
    { key: "running_club", label: "Club", type: "text", required: false },
  ];
  it("accepts valid data and rejects a bad select value", () => {
    expect(customDataSchema(fields).safeParse({ blood_type: "O" }).success).toBe(true);
    expect(customDataSchema(fields).safeParse({ blood_type: "Z" }).success).toBe(false);
  });
  it("requires required fields", () => {
    expect(customDataSchema(fields).safeParse({}).success).toBe(false);
  });
});

describe("formatPeso", () => {
  it("formats centavos as pesos", () => {
    expect(formatPeso(150000)).toBe("₱1,500.00");
  });
});

describe("registrationInputSchema", () => {
  it("rejects an empty idempotency key", () => {
    const bad = registrationInputSchema.safeParse({
      event_id: "00000000-0000-0000-0000-0000000000e1",
      category_id: "00000000-0000-0000-0000-0000000000c1",
      waiver_accepted: true,
      idempotency_key: "",
    });
    expect(bad.success).toBe(false);
  });
});

describe("profile vocabulary", () => {
  it("isProfileKey recognizes passport keys and rejects event keys", () => {
    expect(isProfileKey("blood_type")).toBe(true);
    expect(isProfileKey("shirt_size")).toBe(true);
    expect(isProfileKey("running_club")).toBe(false);
    expect(isProfileKey("bus_pickup_point")).toBe(false);
  });
  it("PROFILE_KEYS is the agreed set", () => {
    expect([...PROFILE_KEYS].sort()).toEqual(
      ["bib_name","blood_type","date_of_birth","emergency_contact","gender","shirt_size"]);
  });
  it("option lists are plain ASCII", () => {
    expect(BLOOD_TYPES).toContain("O-");
    expect(SHIRT_SIZES).toContain("XL");
    expect(GENDERS).toContain("Prefer not to say");
    expect(BLOOD_TYPES.join("")).not.toMatch(/[−–]/); // no unicode minus/en-dash
  });
});

describe("customDataSchema ignores non-declared keys (passport snapshot survives)", () => {
  it("validates event fields and leaves extra snapshot keys untouched", () => {
    const fields: FormField[] = [{ key: "running_club", label: "Club", type: "text", required: false }];
    // A passport snapshot rides along in custom_data; non-strict schema must accept it.
    expect(customDataSchema(fields).safeParse(
      { running_club: "Trailblazers", bib_name: "JR", blood_type: "O+" }).success).toBe(true);
  });
});

describe("formatAddress", () => {
  it("City, Province; null province → City; null city → ''", () => {
    expect(formatAddress({ city_name: "Digos City", province_name: "Davao del Sur" })).toBe("Digos City, Davao del Sur");
    expect(formatAddress({ city_name: "City of Manila", province_name: null })).toBe("City of Manila");
    expect(formatAddress({ city_name: null, province_name: "X" })).toBe("");
  });
});

describe("formatDateRange", () => {
  const fmt = (iso: string) => iso; // identity formatter — isolates range-composition logic from date formatting
  it("returns '' when there is no start date", () => {
    expect(formatDateRange(null, null, fmt)).toBe("");
  });
  it("returns just the start date when there is no end date", () => {
    expect(formatDateRange("2026-09-01", null, fmt)).toBe("2026-09-01");
  });
  it("collapses to a single date when end equals start", () => {
    expect(formatDateRange("2026-09-01", "2026-09-01", fmt)).toBe("2026-09-01");
  });
  it("joins start and end with an en dash when they differ", () => {
    expect(formatDateRange("2026-09-01", "2026-09-03", fmt)).toBe("2026-09-01 – 2026-09-03");
  });
});
