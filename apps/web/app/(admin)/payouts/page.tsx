import { notFound } from "next/navigation";
import { ShieldCheck, Banknote, Landmark, PauseCircle, CheckCircle2 } from "lucide-react";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import {
  listPayoutStatements, listOpenableEvents, payoutRowState, payoutKpis, statementResidual,
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

/** Commission, processing and both refund columns are STORED positive but are
 *  all subtractions from gross, so they render with an explicit minus — making
 *  the gross → commission → processing → refunds → clawback → net arithmetic
 *  legible across the row. Zero renders as plain ₱0, never as −₱0. */
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
  // Statements whose own printed terms do not explain their net owed. Expected
  // to be empty — `statementResidual` documents why the five columns below are
  // exhaustive — and surfaced rather than trusted, because this table is the
  // source document somebody keys a bank transfer from.
  const unreconciled = rows.filter((r) => statementResidual(r) !== 0);

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
          {/* The chain has to name every column the table prints, or the
              subtitle is a shorter identity than the row and the operator is
              told to expect arithmetic that does not close. */}
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            One statement per event · gross → commission → processing → refunds → clawback → net owed
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
          // "net of commission" alone was true when the ledger had two parties.
          // Processing is a second deduction sitting inside this figure, and a
          // caption that names one of two subtractions reads as naming both.
          delta={{
            text: kpis.processingCents > 0
              ? `net of commission and ${peso(kpis.processingCents)} processing`
              : "net of commission and processing",
            tone: "neutral",
          }}
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
                <TableHead className="text-right">Processing</TableHead>
                {/* TWO refund columns, not one, and they are not interchangeable.
                    "Refunds" is money returned out of THIS statement's own
                    earnings; "Clawback" is money an earlier statement already
                    transferred and is being recovered here. Both are subtracted,
                    only one of them can ever apply to a given payment, and
                    collapsing them makes a clawback statement fail to add up by
                    exactly the amount being recovered. The legend under the
                    table says this in words. */}
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Clawback</TableHead>
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
                    <TableCell className="py-2.5 text-right tabular-nums">{deduction(row.processing_cents)}</TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums">{deduction(row.refunds_in_period_cents)}</TableCell>
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

      {rows.length > 0 ? (
        <p className="mt-3 rounded-[9px] border bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          <b className="font-semibold text-foreground">Every row adds up left to right:</b>{" "}
          gross {MINUS} commission {MINUS} processing {MINUS} refunds {MINUS} clawback = net owed.{" "}
          <b className="font-semibold text-foreground">Gross</b> is what runners were charged on this
          statement&apos;s entries, before any deduction — not the &quot;Gross revenue&quot; on an
          organizer&apos;s dashboard, which is already net of refunds.{" "}
          <b className="font-semibold text-foreground">Processing</b> is what the payment provider took.{" "}
          <b className="font-semibold text-foreground">Refunds</b> went back to runners out of money this
          statement has not paid out yet. <b className="font-semibold text-foreground">Clawback</b> is money an
          earlier statement already transferred to the organizer and that has since been refunded, so it is
          recovered here — which is why a statement can end up negative.
        </p>
      ) : null}

      {unreconciled.length > 0 ? (
        <p className="mt-3 rounded-[9px] border border-l-[3px] border-l-destructive bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          <b className="font-semibold text-foreground">
            {unreconciled.length} statement{unreconciled.length === 1 ? "" : "s"} do
            {unreconciled.length === 1 ? "es" : ""} not add up.
          </b>{" "}
          {unreconciled.map((r) => `${r.event_name} (${peso(Math.abs(statementResidual(r)))} unexplained)`).join(", ")}.
          The net owed is still what the statement froze at the moment it was opened, and paying it transfers the
          right amount — but the breakdown beside it does not reach that figure, so do not use these lines to
          explain the transfer to an organizer until it is investigated.
        </p>
      ) : null}

      {kpis.owedBackCount > 0 ? (
        <p className="mt-3 rounded-[9px] border border-l-[3px] border-l-destructive bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          <b className="font-semibold text-foreground">
            {kpis.owedBackCount} statement{kpis.owedBackCount === 1 ? "" : "s"} with a negative balance
            ({peso(kpis.owedBackCents)} total).
          </b>{" "}
          Refunds landed on money already transferred — the Clawback column — and no new sales followed, so the organization owes
          Race Pace rather than the other way round. Use <b className="font-semibold text-foreground">Record
          recovery</b> once the money is back — it closes the statement and marks those refunds recovered so
          they are never deducted twice.
        </p>
      ) : null}
    </div>
  );
}
