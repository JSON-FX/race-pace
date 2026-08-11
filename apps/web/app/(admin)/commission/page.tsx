import { notFound } from "next/navigation";
import { Landmark, Percent, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { getCommissionOverview } from "@/lib/queries/commission";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { TableEmptyState } from "@/components/data-table";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { peso } from "@/lib/format";
import { FeeTermsTable, RefundTermsTable } from "./terms-row";

const TH = "h-9 px-[14px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground";

/** The mockup's `.hd` — a card title with a right-aligned aside that says what
 *  the table below is actually claiming. */
function CardHead({ title, aside }: { title: string; aside: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-divider px-[15px] py-3">
      <b className="text-[13.5px] font-bold tracking-[-0.01em]">{title}</b>
      <span className="flex-1" />
      <span className="text-[11.5px] font-semibold text-muted-foreground">{aside}</span>
    </div>
  );
}

export default async function CommissionPage() {
  const roles = await getMyRoles();
  // The nav already hides Platform items from org staff
  // (lib/nav-items.ts#visibleSuperItems), but a typed URL must not reach the
  // page. notFound() rather than a redirect: to anyone who is not a super admin,
  // this page does not exist. RLS enforces the same rule on every read and write
  // underneath — this is the UI half, not the boundary.
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) notFound();

  const { orgs, events, totals } = await getCommissionOverview();

  // charged_gross, NOT gross. A rate is struck on what the runner was charged, so
  // dividing by revenue that a refund has already been netted out of prints a rate
  // nobody is on: one partially refunded ₱2,000 entry retained at ₱300 turns a 3%
  // org into "15.4%" on the page an operator negotiates rates from.
  const effectiveRate = totals.charged_gross > 0 ? (totals.commission / totals.charged_gross) * 100 : 0;

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      {/* Scope band — this page is not scoped to the selected org, and saying so
          matters on a console where every other page is. */}
      <div className="mb-[13px] flex items-center gap-2.5 rounded-xl bg-forest px-4 py-3 text-white">
        <ShieldCheck className="size-[17px] shrink-0" strokeWidth={1.9} aria-hidden />
        <b className="text-[13.5px] font-bold">Platform scope</b>
        <span className="text-[12px] font-semibold text-white/60">All organizations · super admin</span>
        <span className="flex-1" />
        <span className="rounded-pill bg-white/15 px-2.5 py-[3px] text-[11px] font-bold tabular-nums">
          {orgs.length} org{orgs.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mb-[14px] flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Commission</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            What Race Pace charges each organizer, and what a cancelling runner gets back.
          </p>
        </div>
      </div>

      <KpiRow>
        <KpiCard
          icon={Percent}
          label="COMMISSION EARNED"
          value={peso(totals.commission)}
          delta={{
            tone: "neutral",
            // A refund does NOT return the platform's fee — since
            // 20260811094000 the commission is an earned service fee and is
            // retained, and the runner gets net_to_org back. So this figure is
            // NOT reduced by refunds; what went back is stated beside it, from
            // payments.refunded_amount, so the card is not read as already
            // netting something it does not.
            text:
              totals.refund_count > 0
                ? `${peso(totals.refunded_cents)} returned on ${totals.refund_count} refund${totals.refund_count === 1 ? "" : "s"}`
                : "No refunds returned yet",
          }}
        />
        <KpiCard
          icon={Wallet}
          label="PLATFORM GMV"
          // Gross MERCHANDISE value: what was sold, not what survived refunds.
          value={peso(totals.charged_gross)}
          delta={{ tone: "neutral", text: `${totals.paid_count.toLocaleString()} paid entries` }}
        />
        <KpiCard
          icon={TrendingUp}
          label="EFFECTIVE RATE"
          value={`${effectiveRate.toFixed(1)}%`}
          delta={{ tone: "neutral", text: `weighted across ${orgs.length} organization${orgs.length === 1 ? "" : "s"}` }}
        />
        <KpiCard
          icon={Landmark}
          label="PASSED TO ORGS"
          value={peso(totals.net_to_org)}
          delta={{ tone: "neutral", text: `${peso(totals.unpaid_out_cents)} not yet paid out` }}
        />
      </KpiRow>

      {orgs.length === 0 ? (
        <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
          <TableEmptyState
            title="No organizations yet"
            description="Commercial terms are set per organization. Provision one and its fee and refund policy will appear here."
          />
        </Card>
      ) : (
        <>
          <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
            <CardHead title="Rate per organization" aside="Applies to future registrations only" />
            <FeeTermsTable orgs={orgs} />
          </Card>

          {/* Refund policy sits on THIS page, under the fee table: one org's
              commercial terms belong on one screen, or an operator negotiating
              with an organizer has to visit two. Design §7. */}
          <Card className="mt-3 gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
            <CardHead title="Refund policy" aside="What a cancelling runner gets back" />
            <RefundTermsTable orgs={orgs} />
          </Card>
        </>
      )}

      <Card className="mt-3 gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        <CardHead title="Commission by event" aside="Where the fee actually came from" />
        {events.length === 0 ? (
          <TableEmptyState
            title="No commission earned yet"
            description="Fees are struck per registration at confirmation. The first paid entry on any event will show up here."
          />
        ) : (
          <Table className="text-[12.5px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Event</TableHead>
                <TableHead className={TH}>Organization</TableHead>
                <TableHead className={`${TH} text-right`}>Paid</TableHead>
                <TableHead className={`${TH} text-right`}>Gross</TableHead>
                <TableHead className={TH}>Fee charged</TableHead>
                <TableHead className={`${TH} text-right`}>Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.event_id}>
                  <TableCell className="px-[14px] py-2.5 font-semibold">{e.event_name}</TableCell>
                  <TableCell className="px-[14px] text-muted-foreground">{e.org_name}</TableCell>
                  <TableCell className="px-[14px] text-right tabular-nums">{e.paid_count.toLocaleString()}</TableCell>
                  <TableCell className="px-[14px] text-right tabular-nums">{peso(e.gross)}</TableCell>
                  <TableCell className="px-[14px]">
                    {/* Read off the payments themselves, not off the org's
                        current terms — the fee was frozen per row, so an event
                        that straddled a change honestly reads as blended. */}
                    <span className="inline-flex items-center rounded-pill bg-info-tint px-2 py-0.5 text-[10.5px] font-bold text-info">
                      {e.charged}
                    </span>
                  </TableCell>
                  <TableCell className="px-[14px] text-right font-semibold tabular-nums">{peso(e.commission)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
