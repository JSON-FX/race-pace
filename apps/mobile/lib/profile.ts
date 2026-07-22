import { supabase } from "./supabase";

export type Profile = {
  id: string;
  full_name: string | null;
  bib_name: string | null;
  city: string | null;
  emergency_contact?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  shirt_size?: string | null;
  blood_type?: string | null;
  city_psgc_code?: string | null;
  city_name?: string | null;
  province_name?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
};

const PROFILE_COLS = "id,full_name,bib_name,city,emergency_contact,date_of_birth,gender,shirt_size,blood_type,city_psgc_code,city_name,province_name,avatar_url,cover_url";

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from("profiles").select(PROFILE_COLS).eq("id", userId).maybeSingle();
  return data as Profile | null;
}

/** Partial upsert: PostgREST merge-duplicates updates only the provided columns. */
export async function upsertProfile(row: Partial<Profile> & { id: string }): Promise<{ error?: string }> {
  const { error } = await supabase.from("profiles").upsert(row);
  return error ? { error: error.message } : {};
}
