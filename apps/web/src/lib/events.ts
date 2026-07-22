import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type AdminEventRow = {
  id: string;
  name: string;
  place: string | null;
  city_name: string | null;
  province_name: string | null;
  event_date: string | null;
  end_date: string | null;
  status: string;
  original_date: string | null;
  categories: { slots_taken: number; slots_total: number }[];
};

export function useOrgEvents(orgId?: string) {
  return useQuery<AdminEventRow[]>({
    queryKey: ["org-events", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id,name,place,city_name,province_name,event_date,end_date,status,original_date,categories(slots_taken,slots_total)")
        .eq("org_id", orgId!)
        .order("event_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdminEventRow[];
    },
  });
}

export type EditorEvent = {
  id: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  event_date: string | null; end_date: string | null; flag_off: string | null; status: string;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  hero_image_url: string | null; gallery: string[];
};
export type EditorCategory = { id: string; code: string; label: string; distance_km: number | null; base_price: number; slots_total: number; slots_taken: number };
export type EditorAddon = { id: string; name: string; price: number };
export type EditorData = { event: EditorEvent; categories: EditorCategory[]; addons: EditorAddon[] };

export function useEventForEditor(id?: string) {
  return useQuery<EditorData | null>({
    queryKey: ["event-editor", id],
    enabled: !!id,
    queryFn: async () => {
      const ev = await supabase.from("events")
        .select("id,org_id,name,city_psgc_code,region_name,province_name,city_name,venue,event_date,end_date,flag_off,status,elevation_gain_m,cutoff_hours,description,hero_image_url,gallery")
        .eq("id", id!).single();
      if (ev.error) throw ev.error;
      const cats = await supabase.from("categories").select("id,code,label,distance_km,base_price,slots_total,slots_taken").eq("event_id", id!).order("base_price", { ascending: false });
      if (cats.error) throw cats.error;
      const adds = await supabase.from("addons").select("id,name,price").eq("event_id", id!).order("created_at");
      if (adds.error) throw adds.error;
      return { event: ev.data as EditorEvent, categories: (cats.data ?? []) as EditorCategory[], addons: (adds.data ?? []) as EditorAddon[] };
    },
  });
}
