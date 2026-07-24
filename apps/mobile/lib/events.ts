import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type EventRow = {
  id: string; org_id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; end_date: string | null; elevation_gain_m: number | null; cutoff_hours: number | null; flag_off?: string | null;
  status: string; hero_image_url: string | null; description: string | null;
  gallery: string[]; original_date: string | null; status_note: string | null;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  joined_count: number; distances: number[]; org_name?: string; org_color?: string | null; org_logo_url?: string | null;
};
export type OrgRow = {
  id: string; name: string; slug: string;
  logo_url: string | null; banner_url: string | null; description: string | null; brand_color: string | null;
  event_count?: number;
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

const EVENT_COLS =
  "id,org_id,name,place,region,event_date,end_date,elevation_gain_m,cutoff_hours,flag_off,status,hero_image_url,description,gallery,original_date,status_note,city_psgc_code,region_name,province_name,city_name,venue,categories(slots_taken,distance_km)";
const ORG_COLS = "id,name,slug,logo_url,banner_url,description,brand_color";
const CAT_COLS = "id,event_id,org_id,code,label,distance_km,base_price,slots_total,slots_taken";

function mapEvent(r: any): EventRow {
  const categories = (r.categories ?? []) as { slots_taken: number; distance_km: number | null }[];
  const joined_count = categories.reduce((sum, c) => sum + c.slots_taken, 0);
  const distances = categories.map((c) => c.distance_km).filter((d): d is number => d != null);
  return { ...r, gallery: r.gallery ?? [], joined_count, distances, org_name: r.organizations?.name, org_color: r.organizations?.brand_color, org_logo_url: r.organizations?.logo_url };
}

// Marketplace: every org's non-draft events (RLS enforces non-draft), with org name + color + logo for the card.
export async function fetchMarketplaceEvents(): Promise<EventRow[]> {
  const { data, error } = await supabase.from("events").select(`${EVENT_COLS},organizations(name,brand_color,logo_url)`).order("event_date");
  if (error) throw error;
  return (data ?? []).map(mapEvent);
}
export function useMarketplaceEvents() {
  return useQuery({ queryKey: ["marketplace-events"], queryFn: fetchMarketplaceEvents });
}

export async function fetchEventsByOrg(orgId: string): Promise<EventRow[]> {
  const { data, error } = await supabase.from("events").select(EVENT_COLS).eq("org_id", orgId).order("event_date");
  if (error) throw error;
  return (data ?? []).map(mapEvent);
}
export function useEventsByOrg(orgId: string) {
  return useQuery({ queryKey: ["events-by-org", orgId], queryFn: () => fetchEventsByOrg(orgId), enabled: !!orgId });
}

export async function fetchEvent(eventId: string): Promise<EventRow | null> {
  const { data, error } = await supabase.from("events").select(`${EVENT_COLS},organizations(name,brand_color,logo_url)`).eq("id", eventId).maybeSingle();
  if (error) throw error;
  return data ? mapEvent(data) : null;
}
export function useEvent(eventId: string) {
  return useQuery({ queryKey: ["event", eventId], queryFn: () => fetchEvent(eventId) });
}

export async function fetchOrgs(): Promise<OrgRow[]> {
  const { data, error } = await supabase.from("organizations").select(`${ORG_COLS},events(count)`).order("name");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, event_count: Array.isArray(r.events) ? (r.events[0]?.count ?? 0) : 0 }));
}
export function useOrgs() {
  return useQuery({ queryKey: ["orgs"], queryFn: fetchOrgs });
}

export async function fetchOrg(id: string): Promise<OrgRow | null> {
  const { data, error } = await supabase.from("organizations").select(ORG_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as OrgRow | null;
}
export function useOrg(id: string) {
  return useQuery({ queryKey: ["org", id], queryFn: () => fetchOrg(id), enabled: !!id });
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
