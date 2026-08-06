import { CalendarDays } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TableEmptyState } from "@/components/data-table";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import type { RosterRow } from "@/lib/checkin";
import { CheckInStation } from "./scanner";
import { EventSwitcher } from "./event-switcher";

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
  return <div className="px-4 pb-10 pt-6 md:px-[30px]">{children}</div>;
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

  const { data: rosterData } = await supabase.rpc("checkin_roster", { p_event_id: event.id });
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

      <CheckInStation eventId={event.id} eventName={event.name} initialRows={rows} />

      <div className="mt-[13px] rounded-[9px] border border-l-[3px] border-l-amber bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
        <b className="font-semibold text-foreground">Two rules the server enforces.</b>{" "}
        An unpaid entry shows as <b className="font-semibold text-foreground">Blocked</b> rather than
        checkable — the check-in function returns <code>not_paid</code> (409) and refuses it, so the
        row reflects a rule the server owns rather than one this page invented. And a re-scan of
        someone already in returns <code>already: true</code>, which surfaces as an amber
        &ldquo;already checked in&rdquo; instead of a green tick, so a double-scan never reads as a
        fresh success.
      </div>
    </Shell>
  );
}
