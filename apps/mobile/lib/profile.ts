import { supabase } from "./supabase";

export type Profile = {
  id: string;
  full_name: string | null;
  bib_name: string | null;
  city: string | null;
  emergency_contact?: string | null;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from("profiles").select("id,full_name,bib_name,city,emergency_contact").eq("id", userId).maybeSingle();
  return data as Profile | null;
}

export async function upsertProfile(row: Profile): Promise<{ error?: string }> {
  const { error } = await supabase.from("profiles").upsert(row);
  return error ? { error: error.message } : {};
}
