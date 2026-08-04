import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type RegistrationRow = {
  id: string;
  user_id: string;
  category_id: string;
  category_label: string | null;
  full_name: string | null;
  bib_name: string | null;
  total_amount: number;
  payment_status: PaymentStatus | null;
  payment_method: string | null;
  created_at: string;
  custom_data: Record<string, unknown>;
};

/**
 * PostgREST's `.or()` filter string is a structural mini-language where
 * `,`, `(`, `)` and `.` separate logic-tree nodes. A raw user search term
 * containing any of those (e.g. "Dela Cruz, Ana") breaks the parse
 * (PGRST100) and 400s the whole query. Quoting the value as
 * `col.ilike."value"` makes it a single opaque token; escape backslashes
 * and double quotes inside it per PostgREST's quoted-value syntax.
 */
function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type RegistrationsQuery = {
  page: number;
  sort: { id: string; desc: boolean }[];
  status: PaymentStatus | "all";
  categoryId: string | "all";
  q: string;
};

export function useEventRegistrations(eventId: string | undefined, query: RegistrationsQuery) {
  const { page, sort, status, categoryId, q } = query;
  return useQuery<{ rows: RegistrationRow[]; total: number }>({
    queryKey: ["event-registrations", eventId, page, sort, status, categoryId, q],
    enabled: !!eventId,
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      let req = supabase
        .from("admin_registrations_v")
        .select(
          "id,user_id,category_id,category_label,full_name,bib_name,total_amount,payment_status,payment_method,custom_data,created_at",
          { count: "exact" }
        )
        .eq("event_id", eventId!);

      if (status !== "all") req = req.eq("payment_status", status);
      if (categoryId !== "all") req = req.eq("category_id", categoryId);
      if (q.trim()) {
        const term = quotePostgrestValue(`%${q.trim()}%`);
        req = req.or(`full_name.ilike.${term},bib_name.ilike.${term}`);
      }
      const s = sort[0] ?? { id: "created_at", desc: true };
      req = req.order(s.id, { ascending: !s.desc }).range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await req;
      if (error) throw error;
      return { rows: (data ?? []) as RegistrationRow[], total: count ?? 0 };
    },
  });
}

export function useRegistrationAddons(registrationId?: string) {
  return useQuery<{ name: string | null; price: number }[]>({
    queryKey: ["registration-addons", registrationId],
    enabled: !!registrationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registration_addons")
        .select("price,addons(name)")
        .eq("registration_id", registrationId!);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((a) => {
        const addon = Array.isArray(a.addons) ? a.addons[0] : a.addons;
        return { name: ((addon as { name?: string })?.name) ?? null, price: a.price as number };
      });
    },
  });
}

export function useEventRegistrationCounts(orgId?: string) {
  return useQuery<Record<string, number>>({
    queryKey: ["event-registration-counts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_event_reg_counts_v")
        .select("event_id,reg_count")
        .eq("org_id", orgId!);
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as { event_id: string; reg_count: number }[]).map((r) => [r.event_id, r.reg_count]));
    },
  });
}

/** Issue a full refund via the admin-refund Edge Function. */
export async function refundRegistration(registrationId: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("admin-refund", { body: { registration_id: registrationId, note: note ?? null } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    const msg =
      status === 403 ? "You don't have permission to refund this registration."
      : status === 409 ? "This registration can't be refunded — it isn't paid."
      : status === 404 ? "Registration not found."
      : "Refund failed. Please try again.";
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export type PaymentRow = {
  registration_id: string;
  event_id: string | null;
  event_name: string | null;
  user_id: string | null;
  full_name: string | null;
  amount: number;
  platform_fee: number;
  net_to_org: number;
  method: string | null;
  status: PaymentStatus;
  created_at: string;
};

export const PAGE_SIZE = 25;

export type PaymentsQuery = {
  page: number;
  sort: { id: string; desc: boolean }[];
  status: PaymentStatus | "all";
  q: string;
};

export function usePayments(orgId: string | undefined, query: PaymentsQuery) {
  const { page, sort, status, q } = query;
  return useQuery<{ rows: PaymentRow[]; total: number }>({
    queryKey: ["org-payments", orgId, page, sort, status, q],
    enabled: !!orgId,
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      let req = supabase
        .from("admin_payments_v")
        .select(
          "registration_id,event_id,event_name,user_id,full_name,amount,platform_fee,net_to_org,method,status,created_at",
          { count: "exact" }
        )
        .eq("org_id", orgId!);

      if (status !== "all") req = req.eq("status", status);
      if (q.trim()) {
        const term = quotePostgrestValue(`%${q.trim()}%`);
        req = req.or(`full_name.ilike.${term},event_name.ilike.${term}`);
      }
      const s = sort[0] ?? { id: "created_at", desc: true };
      req = req.order(s.id, { ascending: !s.desc }).range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await req;
      if (error) throw error;
      return { rows: (data ?? []) as PaymentRow[], total: count ?? 0 };
    },
  });
}
