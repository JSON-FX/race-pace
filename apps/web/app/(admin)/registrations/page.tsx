import Link from "next/link";
import { ClipboardList, CheckCircle2, Wallet, Undo2, Download } from "lucide-react";
import { parseTableParams, serializeTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import {
  listEventRegistrations,
  listOrgEventOptions,
  listEventCategories,
  getRegistrationAggregates,
} from "@/lib/queries/registrations";
import { TableEmptyState } from "@/components/data-table";
import { NoOrgScope } from "@/components/no-org-scope";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { peso } from "@/lib/format";
import { EventPicker } from "./event-picker";
import { RegistrationsTable } from "./registrations-table";

const DEFAULTS = { sort: [{ id: "created_at", desc: true }], filters: { status: "all", category: "all" } };

export default async function RegistrationsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // searchParams is a Promise in Next 15 and must be awaited.
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  // See requireOrgId's doc comment: a super_admin with no org-scoped
  // admin/editor row clears the (admin) layout's `isAdmin` guard with
  // `orgId: null`. Branch before calling any org-scoped query, don't assert
  // the id and let it crash.
  const orgId = requireOrgId(roles);

  if (!orgId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <div className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Registrations</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  const events = await listOrgEventOptions(orgId);
  // `event` is a filter key, so parseTableParams already surfaced it. Default
  // to the most recent event so the page is never empty on first visit.
  const eventId = params.filters.event && params.filters.event !== "all"
    ? params.filters.event
    : events[0]?.id;

  if (!eventId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <h1 className="mb-5 text-xl font-bold tracking-tight">Registrations</h1>
        <div className="rounded-xl border border-border bg-card">
          <TableEmptyState title="No events yet" description="Create an event before you can take registrations." />
        </div>
      </div>
    );
  }

  // Explicitly pin `event` to the resolved eventId (not params.filters.event,
  // which may be absent when the page fell back to the org's most recent
  // event) so the Export CSV link always carries the SAME event scope the
  // page is actually rendering — otherwise a bare `/registrations` visit
  // would link to an export that defaults independently and could resolve
  // to a different event if one gets created between the two requests.
  const exportHref = `/registrations/export?${serializeTableParams(
    { ...params, page: 1, filters: { ...params.filters, event: eventId } },
    DEFAULTS,
  )}`;

  const [{ rows, total }, categories, aggregates] = await Promise.all([
    listEventRegistrations(eventId, params),
    listEventCategories(eventId),
    // Same event + same filters as the table above — see getRegistrationAggregates'
    // doc comment for why this is an RPC over the shared view rather than a sum
    // over `rows` (which would describe one page, not the filtered set).
    getRegistrationAggregates(eventId, params),
  ]);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Registrations</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono tabular">{total}</span> registration{total === 1 ? "" : "s"} for this event
          </p>
        </div>
        {/* Manual entry (primary, Plus) is out of scope for this task — see
            task-v4-report.md. Only the Export CSV route + button ships here. */}
        <Button variant="outline" asChild>
          <Link href={exportHref}>
            <Download />
            Export CSV
          </Link>
        </Button>
      </div>

      <KpiRow>
        <KpiCard
          icon={ClipboardList}
          label="Total"
          value={aggregates.total.toLocaleString()}
          delta={{
            text: `+${aggregates.newThisWeek.toLocaleString()} this week`,
            tone: aggregates.newThisWeek > 0 ? "positive" : "neutral",
          }}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Paid"
          value={aggregates.paid.toLocaleString()}
          delta={{
            text: `${aggregates.total > 0 ? ((aggregates.paid / aggregates.total) * 100).toFixed(1) : "0.0"}% conversion`,
            tone: "neutral",
          }}
        />
        {/* MoM delta omitted — see task-v2-report.md ("Deltas shipped vs
            omitted"): a month-over-month comparison needs a second
            time-windowed query with an ambiguous boundary (calendar month vs.
            rolling 30d) and reads as noise against this org's sparse,
            single-month seed data. Rather than fabricate a plausible-looking
            percentage, the card renders the value alone. */}
        <KpiCard icon={Wallet} label="Gross revenue" value={peso(aggregates.grossCents)} />
        <KpiCard
          icon={Undo2}
          label="Refunds"
          value={peso(aggregates.refundedCents)}
          delta={{
            // Deliberately NOT "· K pending": there is no refund-approval
            // queue in this schema yet (refunds run through
            // refund_registration_tx, supabase/migrations/20260723100000_
            // money_txn_rpcs.sql, one atomic transition straight to
            // 'refunded' — the queue is Payments A2, not yet built). "0
            // pending" would assert the system tracks pending refunds and
            // found none; it doesn't track them at all, so the question is
            // unanswerable, not answered-zero. Same judgment already applied
            // to the omitted MoM delta above — don't invent a number a
            // reader can't tell "we checked" from "we have no idea" on.
            text: `${aggregates.refundCount.toLocaleString()} request${aggregates.refundCount === 1 ? "" : "s"}`,
            tone: "neutral",
          }}
        />
      </KpiRow>

      <div className="mb-3">
        <EventPicker events={events} value={eventId} />
      </div>

      <RegistrationsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q} categories={categories} />
    </div>
  );
}
