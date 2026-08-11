import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Wallet, Landmark, Clock } from "lucide-react";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { getOrgDashboard, getOrgUpcomingEvents } from "@/lib/queries/dashboard";
import { NoOrgScope } from "@/components/no-org-scope";
import { TableEmptyState } from "@/components/data-table";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { SignupsChart } from "@/components/SignupsChart";
import { FillRatePanel } from "@/components/FillRatePanel";
import { EventStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { peso, fmtDate } from "@/lib/format";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <h1 className="mb-5 text-[21px] font-bold tracking-[-0.02em]">Dashboard</h1>
      {children}
    </div>
  );
}

/** Card header strip — the mockup's `.card .hd`: a bold title on the left and
 *  a small muted qualifier on the right that says what window the card covers.
 *  Not `CardHeader` from ui/card: that one is a 6-unit-padded grid built for
 *  title + description + action, and these cards need a single dense row with
 *  a divider under it. */
function CardHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-divider px-[15px] py-[13px]">
      <b className="text-sm font-bold tracking-[-0.01em]">{title}</b>
      <span className="ml-auto text-[11.5px] font-semibold text-muted-foreground">{note}</span>
    </div>
  );
}

export default async function DashboardPage() {
  const roles = await getMyRoles();
  // The (admin) layout only asserts SOME capability, so /check-in stays
  // reachable for a marshal — it does NOT mean every other route is safe to
  // render for them. Every capability that reaches the layout except
  // `check_in` includes `manage_org`, but `check_in` is exactly the one this
  // branch newly admits past the layout gate, so this page must assert it
  // itself or a marshal typing this URL gets a fully rendered page of
  // zeros and empty tables — indistinguishable from "this org has no data".
  // redirect(), not notFound(): notFound() is reserved for the platform
  // pages, where whether the page exists is itself information this org-
  // scoped page doesn't carry.
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");
  // See requireOrgId's doc comment: a super_admin with no org-scoped
  // admin/editor row clears the (admin) layout's `isAdmin` guard with
  // `orgId: null`. Branch before calling any org-scoped query, don't assert
  // the id and let it crash.
  const orgId = requireOrgId(roles);
  if (!orgId) return <Shell><NoOrgScope /></Shell>;

  const [data, events] = await Promise.all([getOrgDashboard(orgId), getOrgUpcomingEvents(orgId)]);

  // A brand-new org gets told what to do next. Four zeros, a flat line and two
  // empty cards are all technically accurate for an org with no events, but
  // they describe a system that measured something and found nothing — the
  // reader would go looking for the bug rather than for the "New event" button.
  if (events.eventCount === 0) {
    return (
      <Shell>
        <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
          <TableEmptyState
            title="Nothing to report yet"
            description="Revenue, sign-ups and fill rate all follow from your events. Create your first one and this page fills in as registrations arrive."
            action={<Button asChild size="sm"><Link href="/events/new">Create an event</Link></Button>}
          />
        </Card>
      </Shell>
    );
  }

  const signupsThisWeek = data.signups.slice(-7).reduce((sum, p) => sum + p.n, 0);

  return (
    <Shell>
      <KpiRow>
        <KpiCard
          icon={ClipboardList}
          label="Registrations"
          value={data.regCount.toLocaleString()}
          delta={{
            // Real: the last 7 points of the 30-day series the chart draws, so
            // the caption and the line can never tell different stories.
            text: `${signupsThisWeek.toLocaleString()} this week`,
            tone: signupsThisWeek > 0 ? "positive" : "neutral",
          }}
        />
        {/* No "vs previous period" delta on the money cards. The mockup shows
            one, but admin_org_totals_v is a lifetime rollup with no time
            dimension — a percentage here would need a second windowed query
            with an arbitrary boundary, and the same judgment was already made
            for the Registrations page's omitted MoM delta. An invented trend
            is worse than no trend. */}
        {/* "Gross revenue" here is RETAINED revenue (admin_org_totals_v.
            gross_revenue — the charge less anything already refunded), while
            the platform console's "GMV" cards on Organizations and Commission
            are what runners were CHARGED. Both are correct for their own page's
            arithmetic and both start with "gross", so the same organization
            reads as two different figures depending on which screen you are on.
            The caption is what tells an operator which one they are looking at.
            Do NOT resolve this by re-routing the figure: which column feeds
            which page was settled deliberately. */}
        <KpiCard
          icon={Wallet}
          label="Gross revenue"
          value={peso(data.grossRevenue)}
          delta={{ tone: "neutral", text: "kept, after refunds returned" }}
        />
        <KpiCard
          icon={Landmark}
          label="Net to org"
          value={peso(data.netToOrg)}
          delta={{
            // Stated as the fee in pesos, not as a rate: commission is
            // flat-or-percent per org, so "after 10% commission" would be a
            // guess for any org on a flat fee.
            text: `after ${peso(data.platformFee)} commission`,
            tone: "neutral",
          }}
        />
        <KpiCard
          icon={Clock}
          label="Awaiting payment"
          value={data.pendingCount.toLocaleString()}
          delta={{
            // Deliberately a share, not "₱X pending": admin_org_totals_v sums
            // money only over paid rows, so the peso value of what's
            // outstanding is not a number this page has.
            text: data.regCount > 0
              ? `${((data.pendingCount / data.regCount) * 100).toFixed(1)}% of registrations`
              : "no registrations yet",
            tone: "neutral",
          }}
        />
      </KpiRow>

      <div className="grid gap-3 min-[900px]:grid-cols-[1.55fr_1fr]">
        <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
          <CardHead title="Sign-ups over time" note="Daily · 30d" />
          <SignupsChart points={data.signups} />
        </Card>
        <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
          {/* "Top N by fill", not "N open events" as the mockup captions it:
              getOrgDashboard slices to the five fullest capped events, so a
              plain count would understate an org with more than five and
              silently mislabel the draft/closed ones it does include. */}
          <CardHead title="Fill rate" note={`Top ${data.fill.length} by fill`} />
          <FillRatePanel rows={data.fill} />
        </Card>
      </div>

      <Card className="mt-3 gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        <CardHead title="Upcoming events" note="Next 60 days" />
        {events.upcoming.length === 0 ? (
          <TableEmptyState
            title="No events in the next 60 days"
            description="Nothing is scheduled to start soon. Past and draft events are still on the Events page."
          />
        ) : (
          <Table className="text-[12.5px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Event</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Registered</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.upcoming.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    {/* `/events/[id]` does not exist — the only per-event route
                        is the editor. Linking to the bare id 404s, and because
                        Next prefetches these on render it 404s in the console
                        before anyone even clicks. Matches events-table.tsx's
                        rowHref. */}
                    <Link href={`/events/${e.id}/edit`} className="hover:underline">{e.name}</Link>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {e.eventDate ? fmtDate(e.eventDate) : "—"}
                  </TableCell>
                  <TableCell><EventStatusBadge status={e.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{e.regCount.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{peso(e.grossRevenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Shell>
  );
}
