import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { RosterRow, EdgeResult } from "./checkinQueue";

export type CheckInBanner = { tone: "success" | "warn" | "error" | "muted"; title: string; detail?: string };

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

export type CheckInEvent = { id: string; name: string; event_date: string | null; end_date: string | null };

/** No org argument: checkin_events() derives scope from the caller's JWT, which
 *  matters because useMyRoles().orgId is null for a pure marshal. */
export function useCheckInEvents() {
  return useQuery<CheckInEvent[]>({
    queryKey: ["checkin-events"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("checkin_events");
      if (error) throw error;
      return (data ?? []) as CheckInEvent[];
    },
  });
}

export function useCheckInRoster(eventId: string | null) {
  return useQuery<RosterRow[]>({
    queryKey: ["checkin-roster", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("checkin_roster", { p_event_id: eventId! });
      if (error) throw error;
      return (data ?? []) as RosterRow[];
    },
  });
}

/** POSTs a ticket to the check-in Edge Function. The single place this request
 *  is built — the offline replay path calls it too. */
export async function postCheckIn(ticketToken: string): Promise<EdgeResult> {
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
}
