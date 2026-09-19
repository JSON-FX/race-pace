import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { passportSchema, passportCompleteness, passportPhoneSchema } from "./passport";

const today = "2026-09-16";
const participant = {
  first_name: "Ana", last_name: "Cruz", date_of_birth: "1950-06-01", gender: "Female",
  contact_number: "0917 123 4567", emergency_contact_name: "Juan Cruz",
  emergency_contact_number: "+63 917 123 4567", emergency_contact_relationship: "Son",
  shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "House 1, Sample Street",
};

describe("new Passport contracts", () => {
  it("accepts a participant without email, team or a personal phone", () => {
    const result = passportSchema(today).parse({ ...participant, emergency_contact_number: participant.contact_number });
    expect(result.contact_number).toBe("09171234567");
    expect(result.emergency_contact_number).toBe(result.contact_number);
    expect(passportCompleteness(participant, today)).toEqual({ complete: true, invalidFields: [] });
  });
  it("requires split names and emergency details independently of legacy fields", () => {
    const result = passportCompleteness({ ...participant, first_name: "  ", emergency_contact_number: "", full_name: "Ana Cruz", emergency_contact: "Juan 09171234567" }, today);
    expect(result.complete).toBe(false);
    expect(result.invalidFields).toEqual(["first_name", "emergency_contact_number"]);
  });
  it.each(["Non-binary", "Prefer not to say", "", "Other"])("requires correction of historical gender %s", (gender) => {
    expect(passportSchema(today).safeParse({ ...participant, gender }).success).toBe(false);
  });
  it.each(["2026-09-17", "1950-02-30", "1950-2-1", "not-a-date"])("rejects invalid/future birth date %s", (date_of_birth) => {
    expect(passportSchema(today).safeParse({ ...participant, date_of_birth }).success).toBe(false);
  });
  it.each(["", "abc", "123", "0917callme", "+000000000"])("rejects invalid phone %s", (value) => {
    expect(passportPhoneSchema.safeParse(value).success).toBe(false);
  });
  it("does not carry ownership, legacy bib name or arbitrary fields into the new contract", () => {
    const parsed = passportSchema(today).parse({ ...participant, bib_name: "ANA", claimed_user_id: "forged" });
    expect(parsed).not.toHaveProperty("claimed_user_id");
    expect(parsed).not.toHaveProperty("bib_name");
    expect(parsed.team_name).toBeUndefined();
  });
  it("requires a complete structured shipping address", () => {
    const withoutAddress = { ...participant, shipping_barangay_code: undefined, shipping_zip_code: undefined, shipping_address_line: undefined };
    expect(passportCompleteness(withoutAddress, today).invalidFields).toEqual([
      "shipping_barangay_code", "shipping_zip_code", "shipping_address_line",
    ]);
    expect(passportSchema(today).parse(participant).shipping_zip_code).toBe("0123");
    expect(passportSchema(today).safeParse({ ...participant, shipping_address_line: "  " }).success).toBe(false);
  });
  it("pins the Deno mirror byte-for-byte", () => {
    expect(readFileSync("supabase/functions/_shared/passport.ts", "utf8"))
      .toBe(readFileSync("packages/shared/src/passport.ts", "utf8"));
  });
});
