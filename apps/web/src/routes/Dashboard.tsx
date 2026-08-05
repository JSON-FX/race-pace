import { Link } from "react-router-dom";
import { formatPeso } from "@race-pace/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EventStatusBadge, PaymentStatusBadge } from "../components/StatusBadge";
import { useMyRoles } from "../lib/roles";
import { useEventTotals, useOrgEvents, useOrgTotals, useRecentSignups } from "../lib/dashboard";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1.5 text-3xl font-bold tracking-tight">{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? null;
  const totals = useOrgTotals(orgId);
  const orgEvents = useOrgEvents(orgId);
  const events = useEventTotals(orgId, orgEvents.data);
  const recent = useRecentSignups(orgId, orgEvents.data);

  const retryAll = () => {
    totals.refetch();
    orgEvents.refetch();
    events.refetch();
    recent.refetch();
  };

  // Checked before the empty-state and loading branches: a failed query must never be
  // rendered as "zero registrations" (that lies to an org that actually has data) and must
  // never fall through to the `!totals.data` read below (that would throw mid-render).
  if (totals.isError || orgEvents.isError || events.isError || recent.isError) {
    return (
      <div className="p-6">
        <Card><CardContent role="alert" className="flex flex-col items-center gap-3 p-12 text-center">
          <h2 className="text-lg font-bold">Couldn't load the dashboard</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Something went wrong fetching your organization's data. Try again.
          </p>
          <Button onClick={retryAll}>Retry</Button>
        </CardContent></Card>
      </div>
    );
  }

  if (totals.isLoading || orgEvents.isLoading || events.isLoading || recent.isLoading) {
    return (
      <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
      </div>
    );
  }

  // With no events at all, tiles of zeros read as breakage. Say what to do instead.
  if ((events.data ?? []).length === 0) {
    return (
      <div className="p-6">
        <Card><CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <h2 className="text-lg font-bold">No events yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Registrations, revenue and check-ins all appear here once you publish an event.
          </p>
          <Button asChild><Link to="/events/new">Create your first event</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  // The error and loading branches above already returned, so this is the success case —
  // but query data types stay optional, so this is a defensive bail-out rather than a `!`
  // assertion the type system can't actually back up.
  const t = totals.data;
  if (!t) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Registrations" value={String(t.reg_count)} sub={`${t.paid_count} paid · ${t.pending_count} pending`} />
        <Tile label="Gross revenue" value={formatPeso(t.gross_revenue)} sub="Paid registrations only" />
        <Tile label="Net to organization" value={formatPeso(t.net_to_org)} sub={`After ${formatPeso(t.platform_fee)} platform fee`} />
        <Tile label="Awaiting payment" value={String(t.pending_count)} sub="Not yet checked in-able" />
      </div>

      {t.reg_count === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No registrations yet. Share your event page to start taking sign-ups.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="border-b border-border px-5 py-3.5 text-sm font-bold">Recent sign-ups</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Runner</TableHead><TableHead>Event</TableHead>
                  <TableHead>Category</TableHead><TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recent.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.full_name ?? "Unknown runner"}</TableCell>
                    <TableCell>{r.event_name}</TableCell>
                    <TableCell>{r.category_label ?? "—"}</TableCell>
                    <TableCell><PaymentStatusBadge status={r.payment_status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-5 py-3.5 text-sm font-bold">Events</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Registrations</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events.data ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <Link to={`/events/${e.id}/edit`} className="hover:underline">{e.name}</Link>
                  </TableCell>
                  <TableCell>{e.event_date ?? "—"}</TableCell>
                  <TableCell><EventStatusBadge status={e.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{e.reg_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(e.gross_revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
