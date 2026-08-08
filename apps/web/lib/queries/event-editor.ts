import { createClient } from "@/lib/supabase/server";
import type { EventDiscipline, RoutePoint } from "@race-pace/shared";
import type { ScheduleItem } from "@/lib/validation";

export type EditorEvent = {
  id: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null;
  city_name: string | null; venue: string | null;
  event_date: string | null; end_date: string | null; flag_off: string | null;
  status: string; discipline: EventDiscipline;
  registration_closes_at: string | null; kit_edit_closes_at: string | null;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  start_lat: number | null; start_lng: number | null; finish_lat: number | null; finish_lng: number | null;
  route: RoutePoint[] | null;
  hero_image_url: string | null; gallery: string[]; schedule: ScheduleItem[]; inclusions: string[];
};
export type EditorCategory = {
  id: string; code: string; label: string; distance_km: number | null; base_price: number;
  slots_total: number; slots_taken: number; elevation_gain_m: number | null;
  cutoff_hours: number | null; blurb: string | null;
};
export type EditorAddon = { id: string; name: string; price: number };
export type EditorData = { event: EditorEvent; categories: EditorCategory[]; addons: EditorAddon[] };

const EVENT_SELECT =
  "id,org_id,name,city_psgc_code,region_name,province_name,city_name,venue,event_date,end_date,flag_off,status,discipline,elevation_gain_m,cutoff_hours,start_lat,start_lng,finish_lat,finish_lng,route,description,hero_image_url,gallery,schedule,inclusions,registration_closes_at,kit_edit_closes_at";

/** Loads one event plus its categories and add-ons for the editor. Ported
 *  verbatim (query shape and column lists) from the old useEventForEditor
 *  react-query hook (lib/events.ts) — just dropping the useQuery wrapper and
 *  running server-side. */
export async function getEventForEditor(id: string): Promise<EditorData | null> {
  const supabase = await createClient();

  const ev = await supabase.from("events").select(EVENT_SELECT).eq("id", id).single();
  if (ev.error) {
    // PGRST116 is "no rows" from .single() — a genuine 404, not a failure.
    if (ev.error.code === "PGRST116") return null;
    throw ev.error;
  }

  const [cats, adds] = await Promise.all([
    supabase.from("categories")
      .select("id,code,label,distance_km,base_price,slots_total,slots_taken,elevation_gain_m,cutoff_hours,blurb")
      .eq("event_id", id).order("base_price", { ascending: false }),
    supabase.from("addons").select("id,name,price").eq("event_id", id).order("created_at"),
  ]);
  if (cats.error) throw cats.error;
  if (adds.error) throw adds.error;

  return {
    event: ev.data as EditorEvent,
    categories: (cats.data ?? []) as EditorCategory[],
    addons: (adds.data ?? []) as EditorAddon[],
  };
}
