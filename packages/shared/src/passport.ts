import { z } from "zod";

// These rules describe the new Passport, not historical profiles. Old values are
// preserved for correction and must never be silently converted to a new choice.
export const PASSPORT_GENDERS = ["Male", "Female"] as const;
export const PASSPORT_REQUIRED_KEYS = [
  "first_name", "last_name", "date_of_birth", "gender", "contact_number",
  "emergency_contact_name", "emergency_contact_number", "emergency_contact_relationship",
  "shipping_barangay_code", "shipping_zip_code", "shipping_address_line",
] as const;
export type PassportRequiredKey = (typeof PASSPORT_REQUIRED_KEYS)[number];

export const EMERGENCY_RELATIONSHIPS = [
  "Mother", "Father", "Parent", "Wife", "Husband", "Spouse", "Partner",
  "Sister", "Brother", "Sibling", "Daughter", "Son", "Child",
  "Grandmother", "Grandfather", "Grandparent", "Granddaughter", "Grandson", "Grandchild",
  "Aunt", "Uncle", "Cousin", "Niece", "Nephew", "Other relative",
  "Guardian", "Caregiver", "Friend", "Coach", "Team manager", "Colleague", "Neighbor", "Other",
] as const;

const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);
export const passportPhoneSchema = requiredText(32)
  .transform((value) => value.replace(/[\s().-]/g, ""))
  .refine((value) => /^(?:\+?[1-9]\d{7,14}|0\d{8,10})$/.test(value), "Enter a valid contact number");

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** today is explicit so browsers, edge handlers and tests can share a date boundary. */
export function passportSchema(today: string) {
  if (!validDate(today)) throw new Error("A valid current ISO date is required");
  return z.object({
    shipping_barangay_code: z.string().regex(/^\d{9}$/, "Select a barangay"),
    shipping_zip_code: z.string().regex(/^\d{4}$/, "Enter a four-digit ZIP code"),
    shipping_address_line: requiredText(300),
    first_name: requiredText(100),
    last_name: requiredText(100),
    shirt_size: z.enum(["XS", "S", "M", "L", "XL", "XXL", ""]).nullable().optional(),
    blood_type: z.enum(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", "Unknown", ""]).nullable().optional(),
    team_name: z.string().trim().max(150).nullable().optional(),
    date_of_birth: z.string().refine((value) => validDate(value) && value <= today, "Enter a valid birth date"),
    gender: z.enum(PASSPORT_GENDERS, { errorMap: () => ({ message: "Select Male or Female" }) }),
    contact_number: passportPhoneSchema,
    emergency_contact_name: requiredText(200),
    emergency_contact_number: passportPhoneSchema,
    emergency_contact_relationship: requiredText(100),
    // This is an unverified contact attribute, never evidence for account claiming.
    participant_email: z.union([z.string().trim().email().max(254), z.literal("")]).nullable().optional(),
  });
}
export type PassportInput = z.infer<ReturnType<typeof passportSchema>>;

export function passportCompleteness(input: unknown, today: string): {
  complete: boolean; invalidFields: string[];
} {
  const result = passportSchema(today).safeParse(input);
  return result.success
    ? { complete: true, invalidFields: [] }
    : { complete: false, invalidFields: [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "passport")))] };
}
