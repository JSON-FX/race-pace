import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type CheckInBanner = { tone: "success" | "warn" | "error" | "muted"; title: string; detail?: string };

export type CheckInReg = {
  id: string; status: string; ticket_token: string | null;
  event_id: string; runner: string; bib: string | null; category: string;
};

export function bannerFor(res: { status: number; body: any }, runner?: string, category?: string): CheckInBanner {
  const detail = [runner, category].filter(Boolean).join(" · ") || undefined;
  if (res.status === 200 && res.body?.ok && res.body?.already) return { tone: "muted", title: "Already checked in", detail };
  if (res.status === 200 && res.body?.ok) return { tone: "success", title: "Checked in", detail };
  switch (res.body?.error) {
    case "not_paid": return { tone: "error", title: "Not paid", detail: "This runner has not completed payment." };
    case "invalid_ticket":
    case "ticket_token_required": return { tone: "error", title: "Invalid ticket", detail: "The QR code could not be verified." };
    case "forbidden": return { tone: "error", title: "Not authorized", detail: "This ticket belongs to another organization." };
    case "not_found": return { tone: "error", title: "Ticket not recognised", detail: "No registration matches this ticket." };
    default: return { tone: "error", title: "Could not reach the server", detail: "Check the connection and scan again." };
  }
}

export function wrongEventBanner(ticketEventName: string): CheckInBanner {
  return { tone: "warn", title: "Wrong event", detail: `This ticket is for ${ticketEventName}.` };
}

/** Reads `eid` from the token body. Signature verification stays on the server — this is
 *  only used to catch a wrong-event scan before we bother the network. */
export function decodeTicketEventId(token: string): string | null {
  const body = token.split(".")[0];
  if (!body) return null;
  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { eid?: string }).eid ?? null;
  } catch {
    return null;
  }
}

export function useCheckInEvents(orgId: string | null) {
  return useQuery({
    queryKey: ["checkin-events", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("events")
        .select("id,name,event_date,end_date").eq("org_id", orgId!).order("event_date");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCheckInRoster(eventId: string | null) {
  return useQuery<CheckInReg[]>({
    queryKey: ["checkin-roster", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.from("registrations")
        .select("id,status,ticket_token,event_id,profiles(full_name,bib_name),categories(label)")
        .eq("event_id", eventId!)
        .in("status", ["paid", "pending"]);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id, status: r.status, ticket_token: r.ticket_token, event_id: r.event_id,
        runner: r.profiles?.full_name ?? "Unknown runner",
        bib: r.profiles?.bib_name ?? null,
        category: r.categories?.label ?? "",
      }));
    },
  });
}

export function useCheckInCount(eventId: string | null) {
  return useQuery({
    queryKey: ["checkin-count", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const [done, total] = await Promise.all([
        supabase.from("checkins").select("id", { count: "exact", head: true }).eq("event_id", eventId!),
        supabase.from("registrations").select("id", { count: "exact", head: true }).eq("event_id", eventId!).eq("status", "paid"),
      ]);
      return { done: done.count ?? 0, total: total.count ?? 0 };
    },
  });
}

export function useSubmitCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ticketToken: string) => {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ ticket_token: ticketToken }),
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checkin-count"] });
    },
  });
}
