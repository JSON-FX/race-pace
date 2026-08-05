import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

/** All money fields are integer centavos. Format with formatPeso at the render edge only. */
export type OrgTotals = {
  reg_count: number; paid_count: number; pending_count: number;
  gross_revenue: number; net_to_org: number; platform_fee: number;
};
export type EventRow = {
  id: string; name: string; event_date: string | null; status: string;
  reg_count: number; gross_revenue: number;
};
export type RecentSignup = {
  id: string; full_name: string | null; event_name: string;
  category_label: string | null; payment_status: string | null; created_at: string;
};
export type OrgEvent = { id: string; name: string; event_date: string | null; status: string };

const ZERO: OrgTotals = {
  reg_count: 0, paid_count: 0, pending_count: 0, gross_revenue: 0, net_to_org: 0, platform_fee: 0,
};

export function useOrgTotals(orgId: string | null) {
  return useQuery<OrgTotals>({
    queryKey: ["dash-org-totals", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_org_totals_v").select("*").eq("org_id", orgId!).maybeSingle();
      if (error) throw error;
      return (data as OrgTotals | null) ?? ZERO;   // no registrations yet is zeros, not an error
    },
  });
}

/** Single source of truth for an org's event list. useEventTotals and useRecentSignups both
 *  take its result as a parameter instead of re-fetching, so the dashboard issues one
 *  "events" request, not two, and a failure here is visible on this query alone rather than
 *  hiding behind two other queries stuck permanently disabled. */
export function useOrgEvents(orgId: string | null) {
  return useQuery<OrgEvent[]>({
    queryKey: ["dash-events", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events").select("id,name,event_date,status").eq("org_id", orgId!).order("event_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OrgEvent[];
    },
  });
}

/** Events joined with their totals. `events` is the already-fetched result of useOrgEvents —
 *  passed in rather than re-queried, since the caller needs that list anyway. */
export function useEventTotals(orgId: string | null, events: OrgEvent[] | undefined) {
  return useQuery<EventRow[]>({
    queryKey: ["dash-event-totals", orgId, events],
    enabled: !!orgId && !!events,
    queryFn: async () => {
      const totals = await supabase.from("admin_event_totals_v").select("event_id,reg_count,gross_revenue").eq("org_id", orgId!);
      if (totals.error) throw totals.error;
      const by = new Map((totals.data ?? []).map((t: any) => [t.event_id, t]));
      return (events ?? []).map((e) => ({
        id: e.id, name: e.name, event_date: e.event_date, status: e.status,
        reg_count: by.get(e.id)?.reg_count ?? 0,
        gross_revenue: by.get(e.id)?.gross_revenue ?? 0,
      }));
    },
  });
}

/** admin_registrations_v has event_id but not event_name — only admin_payments_v does —
 *  so the name is stitched from `events`, the same list useEventTotals uses, passed in by
 *  the caller rather than re-fetched. */
export function useRecentSignups(orgId: string | null, events: OrgEvent[] | undefined) {
  return useQuery<RecentSignup[]>({
    queryKey: ["dash-recent", orgId, events],
    enabled: !!orgId && !!events,
    queryFn: async () => {
      const regs = await supabase.from("admin_registrations_v")
        .select("id,event_id,full_name,category_label,payment_status,created_at")
        .eq("org_id", orgId!).order("created_at", { ascending: false }).limit(8);
      if (regs.error) throw regs.error;
      const names = new Map((events ?? []).map((e) => [e.id, e.name]));
      return (regs.data ?? []).map((r: any) => ({
        id: r.id, full_name: r.full_name,
        event_name: names.get(r.event_id) ?? "—",
        category_label: r.category_label, payment_status: r.payment_status, created_at: r.created_at,
      }));
    },
  });
}
