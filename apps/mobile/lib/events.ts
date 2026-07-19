import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type EventRow = {
  id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; elevation_gain_m: number | null; cutoff_hours: number | null; status: string;
};
export type CategoryRow = {
  id: string; event_id: string; org_id: string; code: string; label: string;
  distance_km: number | null; base_price: number; slots_total: number; slots_taken: number;
};
export type AddonRow = { id: string; name: string; price: number };
export type FormFieldRow = {
  id: string; key: string; label: string;
  type: "text" | "number" | "select" | "checkbox" | "date" | "file";
  required: boolean; options: string[] | null; sort_order: number;
};

const EVENT_COLS = "id,name,place,region,event_date,elevation_gain_m,cutoff_hours,status";
const CAT_COLS = "id,event_id,org_id,code,label,distance_km,base_price,slots_total,slots_taken";

export async function fetchEvents(orgId: string): Promise<EventRow[]> {
  const { data, error } = await supabase.from("events").select(EVENT_COLS).eq("org_id", orgId).order("event_date");
  if (error) throw error;
  return (data ?? []) as EventRow[];
}
export function useEvents(orgId: string | null) {
  return useQuery({ queryKey: ["events", orgId], queryFn: () => fetchEvents(orgId!), enabled: !!orgId });
}

export async function fetchEvent(eventId: string): Promise<EventRow | null> {
  const { data, error } = await supabase.from("events").select(EVENT_COLS).eq("id", eventId).maybeSingle();
  if (error) throw error;
  return data as EventRow | null;
}
export function useEvent(eventId: string) {
  return useQuery({ queryKey: ["event", eventId], queryFn: () => fetchEvent(eventId) });
}

export async function fetchCategories(eventId: string): Promise<CategoryRow[]> {
  const { data, error } = await supabase.from("categories").select(CAT_COLS).eq("event_id", eventId).order("base_price", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CategoryRow[];
}
export function useCategories(eventId: string) {
  return useQuery({ queryKey: ["categories", eventId], queryFn: () => fetchCategories(eventId) });
}

export async function fetchCategory(categoryId: string): Promise<CategoryRow | null> {
  const { data, error } = await supabase.from("categories").select(CAT_COLS).eq("id", categoryId).maybeSingle();
  if (error) throw error;
  return data as CategoryRow | null;
}
export function useCategory(categoryId: string) {
  return useQuery({ queryKey: ["category", categoryId], queryFn: () => fetchCategory(categoryId) });
}

export async function fetchAddons(eventId: string): Promise<AddonRow[]> {
  const { data, error } = await supabase.from("addons").select("id,name,price").eq("event_id", eventId).order("price");
  if (error) throw error;
  return (data ?? []) as AddonRow[];
}
export function useAddons(eventId: string) {
  return useQuery({ queryKey: ["addons", eventId], queryFn: () => fetchAddons(eventId) });
}

export async function fetchFormFields(eventId: string): Promise<FormFieldRow[]> {
  const { data, error } = await supabase.from("form_fields")
    .select("id,key,label,type,required,options,sort_order").eq("event_id", eventId).eq("is_active", true).order("sort_order");
  if (error) throw error;
  return (data ?? []) as FormFieldRow[];
}
export function useFormFields(eventId: string) {
  return useQuery({ queryKey: ["form_fields", eventId], queryFn: () => fetchFormFields(eventId) });
}
