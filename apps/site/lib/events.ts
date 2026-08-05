import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldType, EventDiscipline } from "@race-pace/shared";

/** One row of the race-morning schedule (`events.schedule`, jsonb array). */
export type ScheduleItem = { time: string; label: string };

export type EventRow = {
  id: string; org_id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; end_date: string | null; elevation_gain_m: number | null;
  cutoff_hours: number | null; flag_off?: string | null;
  status: string; hero_image_url: string | null; description: string | null;
  gallery: string[]; original_date: string | null; status_note: string | null;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null;
  city_name: string | null; venue: string | null; inclusions?: string[] | null;
  joined_count: number; distances: number[];
  org_name?: string; org_color?: string | null; org_logo_url?: string | null;
  // NOT NULL in the DB (default 'trail' / '[]') — optional here only so the
  // handful of test fixtures built before this task keep type-checking.
  // Real rows always carry both; treat a missing value the same as the DB
  // default via disciplineLayout()/`?? []`, never as an error.
  discipline?: EventDiscipline | string | null;
  schedule?: ScheduleItem[] | null;
};

export type OrgRow = {
  id: string; name: string; slug: string;
  logo_url: string | null; banner_url: string | null;
  description: string | null; brand_color: string | null;
};

export type CategoryRow = {
  id: string; event_id: string; org_id: string; code: string; label: string;
  distance_km: number | null; base_price: number; slots_total: number; slots_taken: number;
  // Per-distance detail, added 2026-08-06 — all nullable, organizers fill
  // these in over time. Null means "not published"; the UI omits the fact
  // rather than rendering 0/—/an empty node.
  elevation_gain_m?: number | null;
  cutoff_hours?: number | null;
  blurb?: string | null;
};

export type AddonRow = { id: string; name: string; price: number };

export type FormFieldRow = {
  id: string; key: string; label: string;
  type: FieldType;
  required: boolean; options: string[] | null; sort_order: number;
};

// Column lists mirror apps/mobile/lib/events.ts, plus `inclusions` on
// EVENT_COLS / EventRow (a real array column mobile does not yet select —
// the pay page here needs it). Don't assume field-for-field parity; check
// apps/mobile/lib/events.ts directly if reconciling the two.
const EVENT_COLS =
  "id,org_id,name,place,region,event_date,end_date,elevation_gain_m,cutoff_hours,flag_off,status,hero_image_url,description,gallery,original_date,status_note,city_psgc_code,region_name,province_name,city_name,venue,inclusions,discipline,schedule,categories(slots_taken,distance_km)";
const CAT_COLS =
  "id,event_id,org_id,code,label,distance_km,base_price,slots_total,slots_taken,elevation_gain_m,cutoff_hours,blurb";

export function mapEvent(r: any): EventRow {
  const categories = (r.categories ?? []) as { slots_taken: number; distance_km: number | null }[];
  return {
    ...r,
    gallery: r.gallery ?? [],
    joined_count: categories.reduce((sum, c) => sum + c.slots_taken, 0),
    distances: categories.map((c) => c.distance_km).filter((d): d is number => d != null),
    org_name: r.organizations?.name,
    org_color: r.organizations?.brand_color,
    org_logo_url: r.organizations?.logo_url,
  };
}

/** Every org's non-draft events — RLS enforces the non-draft filter. */
export async function fetchMarketplaceEvents(db: SupabaseClient): Promise<EventRow[]> {
  const { data, error } = await db
    .from("events")
    .select(`${EVENT_COLS},organizations(name,brand_color,logo_url)`)
    .order("event_date");
  if (error) throw error;
  return (data ?? []).map(mapEvent);
}

export async function fetchEvent(db: SupabaseClient, eventId: string): Promise<EventRow | null> {
  const { data, error } = await db
    .from("events")
    .select(`${EVENT_COLS},organizations(name,brand_color,logo_url)`)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapEvent(data) : null;
}

export async function fetchCategories(db: SupabaseClient, eventId: string): Promise<CategoryRow[]> {
  const { data, error } = await db
    .from("categories").select(CAT_COLS).eq("event_id", eventId)
    .order("base_price", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CategoryRow[];
}

export async function fetchCategory(db: SupabaseClient, categoryId: string): Promise<CategoryRow | null> {
  const { data, error } = await db.from("categories").select(CAT_COLS).eq("id", categoryId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as CategoryRow | null;
}

export async function fetchAddons(db: SupabaseClient, eventId: string): Promise<AddonRow[]> {
  const { data, error } = await db.from("addons").select("id,name,price").eq("event_id", eventId).order("price");
  if (error) throw error;
  return (data ?? []) as AddonRow[];
}

export async function fetchFormFields(db: SupabaseClient, eventId: string): Promise<FormFieldRow[]> {
  const { data, error } = await db
    .from("form_fields").select("id,key,label,type,required,options,sort_order")
    .eq("event_id", eventId).eq("is_active", true).order("sort_order");
  if (error) throw error;
  return (data ?? []) as FormFieldRow[];
}
