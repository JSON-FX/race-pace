import { CalendarDays, ChevronDown, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TableEmptyState } from "@/components/data-table";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import type { RosterRow } from "@/lib/checkin";
import { CheckInStation } from "./scanner";
import { EventSwitcher } from "./event-switcher";
import { CheckInHistory } from "./history";

type CheckinEvent = { id: string; name: string; event_date: string | null; end_date: string | null };

/** The event whose start line is happening now, or next. `checkin_events()`
 *  already orders by date, so "first one that hasn't finished" is the right
 *  default — a marshal opening the page on race morning should not have to
 *  pick their race out of a list of last season's. */
function pickEvent(events: CheckinEvent[], requested: string | undefined, today: string): CheckinEvent | null {
  if (events.length === 0) return null;
  const match = requested ? events.find((e) => e.id === requested) : undefined;
  if (match) return match;
  const live = events.find((e) => (e.end_date ?? e.event_date ?? "9999-12-31") >= today);
  return live ?? events[events.length - 1];
}

function dateLabel(e: CheckinEvent): string {
  if (!e.event_date) return "Date TBC";
  if (e.end_date && e.end_date !== e.event_date) return `${fmtDate(e.event_date)} – ${fmtDate(e.end_date)}`;
  return fmtDate(e.event_date);
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="fieldnotes-admin-workspace" data-fieldnotes-section="Race day / Start line">{children}</div>;
}

/**
 * Race-day check-in.
 *
 * Deliberately NOT gated on `requireOrgId`: nothing here takes an org id.
 * `checkin_events()` and `checkin_roster()` are security-definer read models
 * that resolve authorization themselves through `auth_can_check_in_event`,
 * which honours a marshal's per-event scope. Threading the caller's "primary"
 * org through instead would be both redundant and wrong — it would hide
 * events a marshal is legitimately scoped to.
 */
export default async function CheckInPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requested = typeof params.event === "string" ? params.event : undefined;

  const supabase = await createClient();
  const { data: eventData, error: eventsError } = await supabase.rpc("checkin_events");
  const events = (eventData ?? []) as CheckinEvent[];

  if (eventsError) {
    return (
      <Shell>
        <h1 className="mb-5 text-[21px] font-bold tracking-[-0.02em]">Check-in</h1>
        <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
          <TableEmptyState
            title="Couldn't load your events"
            description="The check-in roster didn't load. Refresh the page — if it keeps failing, your account may not be scoped to any event."
          />
        </Card>
      </Shell>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const event = pickEvent(events, requested, today);

  if (!event) {
    return (
      <Shell>
        <h1 className="mb-5 text-[21px] font-bold tracking-[-0.02em]">Check-in</h1>
        <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
          <TableEmptyState
            title="No events to check runners in to"
            description="Check-in opens once you have an event. Create one under Events, or ask an org admin to scope your account to a race."
          />
        </Card>
      </Shell>
    );
  }

  const { data: required, error: modeError } = await supabase.rpc("checkin_event_required", { p_event_id: event.id });
  if (modeError || typeof required !== "boolean") {
    return <Shell><Card className="p-5" role="alert">Couldn’t load this event’s check-in setting. Refresh and try again.</Card></Shell>;
  }
  const { data: rosterData } = required
    ? await supabase.rpc("checkin_roster", { p_event_id: event.id })
    : { data: [] };
  const rows = (rosterData ?? []) as RosterRow[];

  return (
    <Shell>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <h1 className="text-[21px] font-bold tracking-[-0.02em]">{event.name}</h1>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-[5px] text-[12.5px] font-semibold">
          <CalendarDays className="size-[13px] text-muted-foreground" aria-hidden />
          {dateLabel(event)}
        </span>
        {events.length > 1 ? (
          // Searchable, because an established organizer accumulates far more
          // events than a dropdown can be scrolled through — and a wrong event
          // picked at a start line checks runners into the wrong race.
          //
          // EventSwitcher keeps the original plain GET form as its pre-hydration
          // render, so the no-JS path this page deliberately had is preserved.
          <EventSwitcher
            events={events.map((e) => ({ id: e.id, name: e.name, subtitle: dateLabel(e) }))}
            value={event.id}
          />
        ) : null}
      </div>

      {required ? (
        <CheckInStation eventId={event.id} eventName={event.name} initialRows={rows} />
      ) : (
        <>
          <Card className="p-5" role="status">
            <h2 className="font-semibold">Check-in not required</h2>
            <p className="text-sm text-muted-foreground">This organizer disabled check-in for this event. Paid tickets and kit collection remain available.</p>
          </Card>
          <CheckInHistory eventId={event.id} revision={0} />
        </>
      )}

      {required && <details className="fieldnotes-rules">
        <summary><ShieldCheck className="size-4 text-primary" aria-hidden /><span>Check-in safeguards</span><ChevronDown className="size-4 text-muted-foreground" aria-hidden /></summary>
        <div className="fieldnotes-rules__content">
          <div><strong>Unpaid entries stay blocked</strong><p>The server refuses check-in with <code>not_paid</code> (409). Take payment before checking the runner in.</p></div>
          <div><strong>Repeat scans stay distinct</strong><p>The server returns <code>already: true</code>. The station shows &ldquo;already checked in&rdquo; instead of a new success.</p></div>
        </div>
      </details>}
    </Shell>
  );
}
