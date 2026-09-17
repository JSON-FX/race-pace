import { createClient } from "@/lib/supabase/client";
import { passportSchema, type PassportInput } from "@race-pace/shared";

export type RunnerPassport = { id: string; claimed_user_id: string | null; legacy_full_name: string | null } & {
  [K in keyof PassportInput]: PassportInput[K] | null;
};

export async function listPassports(): Promise<RunnerPassport[]> {
  const { data, error } = await createClient().from("runner_passports").select(
    "id,claimed_user_id,legacy_full_name,shipping_barangay_code,shipping_zip_code,shipping_address_line,shirt_size,blood_type,first_name,last_name,team_name,date_of_birth,gender,contact_number,emergency_contact_name,emergency_contact_number,emergency_contact_relationship,participant_email",
  ).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as RunnerPassport[];
}

export async function createManagedPassport(id: string): Promise<void> {
  const { error } = await createClient().rpc("passport_create_managed", { p_passport_id: id });
  if (error) throw new Error(error.message);
}

export async function savePassport(id: string, input: unknown, today: string): Promise<RunnerPassport> {
  const parsed = passportSchema(today).parse(input);
  const values = { ...parsed, shipping_barangay_code: parsed.shipping_barangay_code || null,
    shipping_zip_code: parsed.shipping_zip_code || null, shipping_address_line: parsed.shipping_address_line || null };
  const { data, error } = await createClient().from("runner_passports").update(values).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as RunnerPassport;
}
