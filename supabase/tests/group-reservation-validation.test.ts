import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { groupReservationInputSchema as edgeSchema } from "../functions/_shared/groupRegistration";
import { groupReservationInputSchema as appSchema } from "../../packages/shared/src/groupRegistration";
import { prepareGroupLine } from "../functions/_shared/groupReservationValidation";
const actor = randomUUID(), passport = randomUUID();
const line = { participant_passport_id: passport, addon_ids: [], custom_data: {}, waiver_accepted: true as const, waiver_acceptance_method: "signed_in_self" as const };
const input = { event_id: randomUUID(), category_id: randomUUID(), idempotency_key: randomUUID(), waiver_version_id: randomUUID(), participants: [line] };
const saved = { id: passport, claimed_user_id: actor, first_name: "Runner", last_name: "One", date_of_birth: "1950-01-01", gender: "Female", contact_number: "09171234567", emergency_contact_name: "Helper", emergency_contact_number: "09171234567", emergency_contact_relationship: "Child", shirt_size: "S", shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "Unit 1, Sample Street" };
it("keeps runtime contracts aligned and rejects duplicate/oversized/forged requests", () => {
  for (const schema of [edgeSchema, appSchema]) {
    expect(schema.parse(input)).toEqual(input);
    expect(schema.safeParse({ ...input, amount: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...input, participants: [line, line] }).success).toBe(false);
    expect(schema.safeParse({ ...input, participants: Array.from({ length: 11 }, () => ({ ...line, participant_passport_id: randomUUID() })) }).success).toBe(false);
    const id = randomUUID();
    expect(schema.safeParse({ ...input, participants: [{ ...line, addon_ids: [id, id] }] }).success).toBe(false);
    expect(schema.safeParse({ ...input, participants: [{ ...line, waiver_accepted: false }] }).success).toBe(false);
  }
});
it("accepts one category per participant and rejects missing or conflicting categories", () => {
  const second = randomUUID();
  const mixed = {
    ...input,
    category_id: undefined,
    participants: [
      { ...line, category_id: randomUUID() },
      { ...line, participant_passport_id: second, category_id: randomUUID() },
    ],
  };
  for (const schema of [edgeSchema, appSchema]) {
    expect(schema.safeParse(mixed).success).toBe(true);
    expect(schema.safeParse({ ...mixed, participants: [{ ...line }] }).success).toBe(false);
    expect(schema.safeParse({ ...input, participants: [{ ...line, category_id: randomUUID() }] }).success).toBe(false);
  }
});
it("freezes saved identity and uses individual kit choices without accepting injected identity", () => {
  const result = prepareGroupLine({ ...line, shirt_size: "XL", custom_data: { first_name: "Forged", blood_type: "Forged", arbitrary: true } }, saved, [], actor, "2026-09-17");
  expect(result.custom_data).toMatchObject({ first_name: "Runner", shirt_size: "XL" });
  expect(result.custom_data).not.toHaveProperty("arbitrary");
  expect(result.custom_data.blood_type).not.toBe("Forged");
});
it("requires complete saved identity, correct acceptance and required answers", () => {
  expect(() => prepareGroupLine(line, { ...saved, first_name: null }, [], actor, "2026-09-17")).toThrow("passport_incomplete");
  expect(() => prepareGroupLine(line, { ...saved, claimed_user_id: null }, [], actor, "2026-09-17")).toThrow("participant_acceptance_required");
  const fields = [{ key: "experience", label: "Experience", type: "text", required: true, options: null }];
  expect(() => prepareGroupLine({ ...line, custom_data: { experience: "  " } }, saved, fields, actor, "2026-09-17")).toThrow("invalid_custom_data");
});
