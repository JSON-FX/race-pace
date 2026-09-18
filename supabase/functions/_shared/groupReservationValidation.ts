import { customDataSchema, formFieldSchema, isProfileKey, passportSchema } from "./validation.ts";
import type { GroupReservationInput } from "./groupRegistration.ts";

type FieldRow = { key: string; label: string; type: string; required: boolean; options: string[] | null };
export class ReservationInputError extends Error {
  constructor(readonly code: string, readonly status: number, readonly passportId?: string) { super(code); }
}

/** Saved identity wins over event answers. Kit size is an explicit per-entry choice. */
export function prepareGroupLine(
  line: GroupReservationInput["participants"][number],
  passport: Record<string, unknown>,
  fields: FieldRow[],
  actorId: string,
  today: string,
) {
  const id = line.participant_passport_id;
  const identity = passportSchema(today).safeParse(passport);
  if (!identity.success) throw new ReservationInputError("passport_incomplete", 422, id);
  const self = passport.claimed_user_id === actorId;
  if (line.waiver_acceptance_method !== (self ? "signed_in_self" : "participant_on_helper_device")) {
    throw new ReservationInputError("participant_acceptance_required", 422, id);
  }
  const p = identity.data;
  const canonical = {
    ...p,
    full_name: `${p.first_name} ${p.last_name}`,
    emergency_contact: `${p.emergency_contact_name} — ${p.emergency_contact_number}`,
    shirt_size: line.shirt_size ?? p.shirt_size ?? null,
  };
  const eventFields = fields.filter((field) => !isProfileKey(field.key) && !(field.key in canonical));
  const definitions = eventFields.map((f) => formFieldSchema.parse({ ...f, options: f.options ?? undefined }));
  const answers = customDataSchema(definitions).safeParse(line.custom_data);
  if (!answers.success || eventFields.some((f) => f.required &&
    (line.custom_data[f.key] == null || (typeof line.custom_data[f.key] === "string" && !(line.custom_data[f.key] as string).trim())))) {
    throw new ReservationInputError("invalid_custom_data", 422, id);
  }
  const customData: Record<string, unknown> = { ...answers.data, ...canonical };
  if (fields.some((f) => f.required && f.key !== "bib_name" &&
    (customData[f.key] == null || (typeof customData[f.key] === "string" && !(customData[f.key] as string).trim())))) {
    throw new ReservationInputError("invalid_custom_data", 422, id);
  }
  return { participant_passport_id: id, passport_snapshot: passport, custom_data: customData };
}
