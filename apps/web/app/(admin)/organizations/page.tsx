import { notFound } from "next/navigation";
import { Building2, Coins, Landmark, Percent, Shield } from "lucide-react";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { getPlatformOrganizations, describeCommission } from "@/lib/queries/organizations";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { peso, initials } from "@/lib/format";
import { NewOrgDialog } from "./new-org-dialog";

/**
 * The scope band (design 2026-08-06 §2, direction B).
 *
 * Organizations, Commission and Payouts show EVERY org's data; every other
 * console page shows one org's. Without a marker, ₱2.18M here and ₱1.41M on
 * Dashboard look like the same kind of number in the same kind of table. The
 * band is the cheapest available guard against reading a platform total as an
 * org total — which is how someone pays an organizer the whole platform's
 * takings.
 *
 * `--color-forest` is the existing dark-surface token (the same one race-day
 * check-in uses); no new colour is introduced.
 */
function ScopeBand({ orgCount }: { orgCount: number }) {
  return (
    <div className="mb-[18px] flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-forest px-4 py-[13px] text-white">
      <Shield className="size-[17px] shrink-0" strokeWidth={2} aria-hidden />
      <b className="text-[13.5px] font-bold">Platform scope</b>
      <span className="text-[12px] font-semibold text-white/60">All organizations · super admin</span>
      <span className="ms-auto rounded-pill bg-white/15 px-2.5 py-[3px] text-[11px] font-bold tabular-nums">
        {orgCount} org{orgCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

export default async function OrganizationsPage() {
  const roles = await getMyRoles();
  // The PLATFORM nav group is already hidden from anyone but a super admin
  // (lib/nav-items.ts#visibleSuperItems), but a typed URL must not reach this
  // page. notFound() rather than a "forbidden" notice: whether the platform
  // console exists is not something an org admin needs told.
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) notFound();

  const { rows, kpis } = await getPlatformOrganizations();

  // Effective rate, not the average of the configured rates. A 10% org doing
  // ₱1.4M and a 5% org doing ₱10k do not average to 7.5% of anything real.
  const effectiveRate = kpis.gmvCents > 0
    ? `avg rate ${((kpis.commissionCents / kpis.gmvCents) * 100).toFixed(1)}%`
    : "no revenue yet";

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <ScopeBand orgCount={kpis.orgCount} />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Organizations</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Every organizer on the platform, with their events and volumes.
          </p>
        </div>
        <NewOrgDialog />
      </div>

      <KpiRow>
        <KpiCard
          icon={Building2}
          label="Organizations"
          value={String(kpis.orgCount)}
          delta={{
            tone: "neutral",
            text: kpis.orgCount === kpis.activeCount
              ? (kpis.orgCount === 1 ? "active" : "all active")
              : `${kpis.activeCount} active`,
          }}
        />
        {/* The caption is the only thing separating this figure from the one an
            organizer's own Dashboard calls "Gross revenue". Both are gross;
            they are not the same quantity. GMV is what runners were CHARGED,
            before refunds (admin_org_totals_v.charged_gross); the Dashboard's
            is what was KEPT, after them (gross_revenue). Same org, two
            different peso amounts, and nothing on either screen said which. */}
        <KpiCard
          icon={Coins}
          label="Platform GMV"
          value={peso(kpis.gmvCents)}
          delta={{ tone: "neutral", text: "charged to runners, before refunds" }}
        />
        <KpiCard
          icon={Percent}
          label="Commission earned"
          value={peso(kpis.commissionCents)}
          delta={{ tone: "neutral", text: effectiveRate }}
        />
        <KpiCard
          icon={Landmark}
          label="Owed to orgs"
          // "Owed" means an OPEN payout statement, matching the Payouts page —
          // not every peso of net_to_org ever collected, most of which has
          // already been settled. The caption carries the nuance a bare figure
          // would hide: ₱0 with no statements open is "nothing has been
          // billed", which is not the same claim as "nothing is outstanding".
          value={kpis.owedCents === null ? "—" : peso(kpis.owedCents)}
          delta={{
            tone: "neutral",
            text: kpis.owedCents === null
              ? "statements unavailable"
              : kpis.openStatements === 0
                ? "no open statements"
                : `${kpis.openStatements} open statement${kpis.openStatements === 1 ? "" : "s"}`,
          }}
        />
      </KpiRow>

      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Registrations</TableHead>
              <TableHead className="text-right">GMV</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-[13px] text-muted-foreground">
                  No organizations yet. Create the first one to get an organizer onto the platform.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((org) => {
                const rate = describeCommission(org);
                return (
                  <TableRow key={org.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground"
                        >
                          {initials(org.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{org.name}</div>
                          <div className="truncate text-xs text-muted-foreground">/{org.slug}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{org.eventCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {org.regCount.toLocaleString()}
                    </TableCell>
                    {/* Integer centavos through peso() — never a bare division
                        at the call site, and never JetBrains Mono, which has no
                        U+20B1 (₱). */}
                    {/* GMV = what was charged. `grossRevenue` is the retained
                        figure and belongs under a different heading. */}
                    <TableCell className="text-right tabular-nums">{peso(org.chargedGross)}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums${rate.zero ? " font-semibold text-destructive" : ""}`}
                      // A ₱0 fee is not a formatting curiosity: it is an
                      // organization the platform earns nothing from, and it
                      // reads as an ordinary tidy number unless it is called out.
                      title={rate.zero ? "Race Pace earns nothing from this organization" : undefined}
                    >
                      {rate.label}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={org.isActive ? "paid" : "neutral"}>
                        {org.isActive ? "Active" : "Inactive"}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
