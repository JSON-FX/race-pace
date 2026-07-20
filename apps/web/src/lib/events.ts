import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type AdminEventRow = {
  id: string;
  name: string;
  event_date: string | null;
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
        .select("id,name,event_date,status,original_date,categories(slots_taken,slots_total)")
        .eq("org_id", orgId!)
        .order("event_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdminEventRow[];
    },
  });
}
