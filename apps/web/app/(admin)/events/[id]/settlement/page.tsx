import { notFound, redirect } from "next/navigation";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { getEventSettlement } from "@/lib/queries/settlement";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TableEmptyState } from "@/components/data-table";
import { peso, fmtDate } from "@/lib/format";
import { ExportSettlementButton } from "./export-button";

const MINUS = "−";
const deduction = (c: number) => (c === 0 ? peso(0) : `${MINUS}${peso(Math.abs(c))}`);

/**
 * The route param is `id`, not the brief's `eventId`.
 *
 * `app/(admin)/events/[id]/` already exists (the event editor lives at
 * `[id]/edit`), and Next.js refuses two different slug names on the same dynamic
 * path — "You cannot use different slug names for the same path ('id' !== 'eventId')"
 * is a build failure, not a warning. One event route, one param name.
 */
export default async function SettlementPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const roles = await getMyRoles();
  // Org-scoped, unlike Commission and Payouts: an organizer SHOULD see their own
  // event's money. `manage_org` is the same capability the Payments page uses,
  // and redirect() rather than notFound() for the same reason it does — an org
  // page that exists but is not yours should say so, whereas a PLATFORM page
  // should not admit it exists at all. RLS on `payments` is the real boundary;
  // this is the capability half.
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");

  const s = await getEventSettlement(id);
  if (!s) notFound();

  // A DIFFERENT rule from the capability check above, and not a restatement of
  // the payments RLS policy either. `events_read_published` admits any
  // authenticated caller to any non-draft event, so without this an editor of
  // org A who pastes org B's event id gets a page headed with B's race name over
  // an all-zero summary — no money leaks, but the page lies about whose event it
  // is. notFound(), matching events/[id]/edit: this IS the "no such event for
  // you" signal, unlike the capability redirect. A super admin admins every org.
  if (!roles?.isSuperAdmin && s.org_id !== roles?.orgId) notFound();

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Settlement · {s.event_name}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Gross → Race Pace commission → payment processing → refunds → net to you
          </p>
        </div>
        <ExportSettlementButton rows={s.rows} eventName={s.event_name} />
      </div>

      <Card className="mb-4 gap-0 rounded-xl border p-[15px] shadow-card">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-5">
          <div><dt className="text-muted-foreground">Gross collected</dt>
            <dd className="font-bold tabular-nums">{peso(s.totals.gross)}</dd></div>
          <div><dt className="text-muted-foreground">Race Pace commission</dt>
            <dd className="font-bold tabular-nums">{deduction(s.totals.commission)}</dd></div>
          <div><dt className="text-muted-foreground">Payment processing</dt>
            <dd className="font-bold tabular-nums">{deduction(s.totals.processing)}</dd></div>
          <div><dt className="text-muted-foreground">Refunds</dt>
            <dd className="font-bold tabular-nums">{deduction(s.totals.refunds)}</dd></div>
          <div><dt className="text-muted-foreground">Net to you</dt>
            <dd className="text-[15px] font-bold tabular-nums">{peso(s.totals.net)}</dd></div>
        </dl>
      </Card>

      {s.projected ? (
        <p className="mb-4 rounded-[9px] border border-l-[3px] border-l-primary bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          <b className="font-semibold text-foreground">
            Projected net {peso(s.projected.low)}–{peso(s.projected.high)}
          </b>{" "}
          depending on how runners pay. Your organization absorbs payment processing, and a card
          costs more to process than an e-wallet — so the final figure moves with the payment mix.
        </p>
      ) : null}

      {/* Three states, not two. `unreconciled === null` means the check itself
          failed, and it gets its own sentence — coercing it to 0 would render
          nothing at all, which reads as "everything is confirmed". */}
      {s.unreconciled === null ? (
        <p className="mb-4 rounded-[9px] border border-l-[3px] border-l-amber bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          We could not check whether any processing fees are still{" "}
          <b className="font-semibold text-foreground">estimated</b> on this event. Treat the
          processing and net figures above as provisional until this page loads cleanly.
        </p>
      ) : s.unreconciled > 0 ? (
        <p className="mb-4 rounded-[9px] border border-l-[3px] border-l-amber bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          {s.unreconciled} payment{s.unreconciled === 1 ? " has" : "s have"} an{" "}
          <b className="font-semibold text-foreground">estimated</b> processing fee awaiting
          confirmation from the payment provider. The figures above may move by a few pesos.
        </p>
      ) : null}

      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        {s.rows.length === 0 ? (
          <TableEmptyState
            title="No payments yet"
            description="Money appears here as runners complete their registrations."
          />
        ) : (
          <Table className="text-[12.5px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Runner</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Processing</TableHead>
                <TableHead className="text-right">Net to you</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.rows.map((r) => (
                <TableRow key={r.registration_id} className={r.status === "refunded" ? "opacity-60" : undefined}>
                  <TableCell className="py-2.5 font-semibold">{r.runner_name}</TableCell>
                  <TableCell className="py-2.5">{r.category}</TableCell>
                  <TableCell className="py-2.5">{r.paid_at ? fmtDate(r.paid_at) : "—"}</TableCell>
                  <TableCell className="py-2.5">{r.method ?? "—"}</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">{peso(r.gross_paid)}</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">{deduction(r.rp_commission)}</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">{deduction(r.processing_fee)}</TableCell>
                  <TableCell className="py-2.5 text-right font-bold tabular-nums">
                    {r.status === "refunded" ? peso(0) : peso(r.net_to_org)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
