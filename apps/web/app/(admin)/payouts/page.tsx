import { notFound } from "next/navigation";
import { ShieldCheck, Banknote, Landmark, PauseCircle, CheckCircle2 } from "lucide-react";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import {
  listPayoutStatements, listOpenableEvents, payoutRowState, payoutKpis,
  type PayoutStatementRow, type PayoutState,
} from "@/lib/queries/payouts";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { StatusBadge, type BadgeTone } from "@/components/StatusBadge";
import { TableEmptyState } from "@/components/data-table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { peso, fmtDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OpenStatementControl, SettleStatementButton } from "./statement-actions";

/** U+2212 MINUS SIGN, not a hyphen. It is the same width as a digit, so a
 *  column of `tabular-nums` figures stays aligned whether or not a row's
 *  amount carries a sign — with a hyphen the signed rows sit a fraction off
 *  and the eye stops trusting the column. */
const MINUS = "−";

/** Commission and refunds are STORED positive but are both subtractions from
 *  gross, so they render with an explicit minus — matching the mockup and
 *  making the gross → commission → refunds → net arithmetic legible across the
 *  row. Zero renders as plain ₱0, never as −₱0. */
function deduction(cents: number): string {
  return cents === 0 ? peso(0) : `${MINUS}${peso(Math.abs(cents))}`;
}

const STATE_BADGE: Record<PayoutState, { label: string; tone: BadgeTone }> = {
  ready: { label: "Ready", tone: "pending" },
  held: { label: "Held · event not finished", tone: "neutral" },
  paid: { label: "Paid", tone: "paid" },
  owed_back: { label: "Owed back by org", tone: "danger" },
};

/** Sub-line under the event name: what the operator needs to answer "why is
 *  this row in this state?" without opening anything. */
function eventCaption(row: PayoutStatementRow, state: PayoutState): string {
  const day = row.end_date ?? row.event_date;
  if (state === "paid" && row.paid_at) return `Settled ${fmtDate(row.paid_at)}`;
  if (state === "owed_back") return day ? `Ran ${fmtDate(day)} · refunded after settlement` : "Refunded after settlement";
  if (state === "held") return day ? `Runs ${fmtDate(day)} · still taking registrations` : "Still taking registrations";
  return day ? `Finished ${fmtDate(day)}` : `Opened ${fmtDate(row.opened_at)}`;
}

export default async function PayoutsPage() {
  const roles = await getMyRoles();
  // Platform-wide page, not an org-scoped one — so no `requireOrgId`/
  // `<NoOrgScope />` branch here. An org admin must not learn that other
  // organizations' settlements exist, so this 404s rather than rendering an
  // explanatory "super admins only" notice the way the org-scoped Team page
  // does. RLS on `payout_statements` is the real lock (it returns zero rows to
  // anyone else) and both RPCs re-check `auth_is_super_admin()` themselves;
  // this guard is what stops the URL from being a directory of what exists.
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) notFound();

  const [rows, openable] = await Promise.all([listPayoutStatements(), listOpenableEvents()]);
  const kpis = payoutKpis(rows);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      {/* Platform scope band. Every other console page is scoped to one
          organization; this one is not, and the band is what says so before
          the operator reads a single figure. */}
      <div className="mb-[13px] flex flex-wrap items-center gap-[11px] rounded-xl bg-forest px-4 py-[13px] text-white">
        <ShieldCheck className="size-[17px] shrink-0" strokeWidth={1.9} aria-hidden />
        <b className="text-[13.5px] font-bold">Platform scope</b>
        <span className="text-[12px] font-semibold text-white/60">All organizations · super admin</span>
        <span className="grow" />
        <span className="rounded-pill bg-white/15 px-[9px] py-[3px] text-[11px] font-bold tabular-nums">
          {peso(kpis.totalOwedCents)} owed
        </span>
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Payouts</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            One statement per event · gross → commission → refunds → net owed
          </p>
        </div>
        <OpenStatementControl events={openable} />
      </div>

      <KpiRow>
        <KpiCard
          icon={Banknote}
          label="READY TO PAY"
          value={String(kpis.readyCount)}
          delta={{ text: `event${kpis.readyCount === 1 ? "" : "s"} finished, unpaid`, tone: "neutral" }}
        />
        <KpiCard
          icon={Landmark}
          label="TOTAL OWED"
          value={peso(kpis.totalOwedCents)}
          delta={{ text: "net of commission", tone: "neutral" }}
        />
        <KpiCard
          icon={PauseCircle}
          label="HELD (LIVE EVENTS)"
          value={peso(kpis.heldCents)}
          delta={{ text: `${kpis.heldCount} event${kpis.heldCount === 1 ? "" : "s"} not finished`, tone: "neutral" }}
        />
        <KpiCard
          icon={CheckCircle2}
          label="PAID THIS MONTH"
          value={peso(kpis.paidThisMonthCents)}
          delta={{
            text: `${kpis.paidThisMonthCount} statement${kpis.paidThisMonthCount === 1 ? "" : "s"} settled`,
            tone: "neutral",
          }}
        />
      </KpiRow>

      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        {rows.length === 0 ? (
          <TableEmptyState
            title="No payout statements yet"
            description="Statements are cut manually, one per event. Choose an event above to open the first one."
          />
        ) : (
          <Table className="text-[12.5px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Event</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Net owed</TableHead>
                <TableHead>Status</TableHead>
                {/* The label belongs to screen readers only, but `sr-only` must
                    sit on a child — on the `<th>` itself it position-absolutes
                    the cell out of the row and the column collapses. */}
                <TableHead className="text-right"><span className="sr-only">Action</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const state = payoutRowState(row);
                const badge = STATE_BADGE[state];
                const owedBack = state === "owed_back";

                return (
                  // Held rows are dimmed, NOT hidden. An organizer asking
                  // "where's my money for Dumalinao?" should be answerable
                  // straight off this screen.
                  <TableRow key={row.id} className={cn(state === "held" && "opacity-70")}>
                    <TableCell className="py-2.5">
                      <div className="font-semibold">{row.event_name}</div>
                      <div className="text-[11px] text-muted-foreground">{eventCaption(row, state)}</div>
                    </TableCell>

                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-[9px]">
                        <span
                          aria-hidden
                          className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-forest text-[9.5px] font-extrabold text-white"
                        >
                          {initials(row.org_name)}
                        </span>
                        {row.org_name}
                      </div>
                    </TableCell>

                    <TableCell className="py-2.5 text-right tabular-nums">{peso(row.gross_cents)}</TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums">{deduction(row.commission_cents)}</TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums">{deduction(row.refunds_cents)}</TableCell>

                    {/* The one cell that can carry money in the WRONG
                        direction. A negative net means the organizer owes Race
                        Pace, and it must never read as an instruction to pay
                        them minus money — so it is marked three independent
                        ways, none of which is colour alone: an explicit minus
                        sign, the words "owed back", and the destructive tone.
                        Anyone reading in greyscale, or colour-blind, still
                        gets an unambiguous answer. */}
                    <TableCell className={cn("py-2.5 text-right tabular-nums", owedBack && "text-destructive")}>
                      <div className="font-bold">
                        {owedBack ? `${MINUS}${peso(Math.abs(row.net_owed_cents))}` : peso(row.net_owed_cents)}
                      </div>
                      {owedBack ? <div className="text-[11px] font-semibold">owed back</div> : null}
                    </TableCell>

                    <TableCell className="py-2.5">
                      <StatusBadge tone={badge.tone}>
                        {state === "paid" && row.paid_at ? `Paid ${fmtDate(row.paid_at)}` : badge.label}
                      </StatusBadge>
                    </TableCell>

                    <TableCell className="py-2.5 text-right">
                      {state === "ready" || state === "owed_back" ? (
                        <SettleStatementButton statement={row} />
                      ) : state === "held" ? (
                        // Disabled rather than absent, with the reason already
                        // spelled out in the Status cell beside it. `title`
                        // repeats it for anyone who hovers wondering why.
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-pill"
                          disabled
                          title="This event is still taking registrations — paying now means paying again later."
                        >
                          Locked
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {row.reference ? `ref ${row.reference}` : "settled"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {kpis.owedBackCount > 0 ? (
        <p className="mt-3 rounded-[9px] border border-l-[3px] border-l-destructive bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          <b className="font-semibold text-foreground">
            {kpis.owedBackCount} statement{kpis.owedBackCount === 1 ? "" : "s"} with a negative balance
            ({peso(kpis.owedBackCents)} total).
          </b>{" "}
          Refunds landed on money already transferred and no new sales followed, so the organization owes
          Race Pace rather than the other way round. Use <b className="font-semibold text-foreground">Record
          recovery</b> once the money is back — it closes the statement and marks those refunds recovered so
          they are never deducted twice.
        </p>
      ) : null}
    </div>
  );
}
