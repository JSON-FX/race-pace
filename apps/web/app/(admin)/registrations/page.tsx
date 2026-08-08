import Link from "next/link";
import { Suspense } from "react";
import { Download, Plus } from "lucide-react";
import { parseTableParams, serializeTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import {
  listOrgEventOptions,
  getOrgRegistrationCount,
  getOrgPendingRegistrationCount,
} from "@/lib/queries/registrations";
import { DataTableSkeleton, TableEmptyState } from "@/components/data-table";
import { NoOrgScope } from "@/components/no-org-scope";
import { KpiRowSkeleton } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EventPicker } from "./event-picker";
import { RegistrationsKpiSection } from "./kpi-section";
import { RegistrationsTableSection } from "./table-section";

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
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Registrations</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  // One burst, not a chain: the event list is needed to resolve `eventId`
  // below, and the two org-wide counts feed the subtitle. Nothing here depends
  // on anything else here. The row and aggregate reads have moved into the
  // suspended sections so they no longer hold up the shell.
  const [events, orgTotal, orgPending] = await Promise.all([
    listOrgEventOptions(orgId),
    // Subtitle figures are deliberately ORG-wide, not scoped to the selected
    // event/filters — see each function's doc comment.
    getOrgRegistrationCount(orgId),
    getOrgPendingRegistrationCount(orgId),
  ]);
  // `event` is a filter key, so parseTableParams already surfaced it. Default
  // to the most recent event so the page is never empty on first visit.
  const eventId = params.filters.event && params.filters.event !== "all"
    ? params.filters.event
    : events[0]?.id;

  if (!eventId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <h1 className="mb-5 text-[21px] font-bold tracking-[-0.02em]">Registrations</h1>
        <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
          <TableEmptyState title="No events yet" description="Create an event before you can take registrations." />
        </Card>
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

  // Keying both boundaries on the resolved params is what makes a skeleton
  // appear on a searchParams-only navigation. `loading.tsx` fires only when the
  // route SEGMENT changes, so switching event, paging, sorting or filtering
  // otherwise leaves the old table on screen with no indication anything is
  // happening. Changing the key remounts the boundary, which re-shows the
  // fallback. Reuses serializeTableParams so the key can never drift from the
  // params the sections are actually handed.
  const sectionKey = serializeTableParams(
    { ...params, filters: { ...params.filters, event: eventId } },
    DEFAULTS,
  ).toString();

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Registrations</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <span className="tabular">{orgTotal.toLocaleString()}</span> total across{" "}
            <span className="tabular">{events.length}</span> event{events.length === 1 ? "" : "s"} ·{" "}
            <span className="tabular">{orgPending.toLocaleString()}</span> pending payment
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={exportHref}>
              <Download />
              Export CSV
            </Link>
          </Button>
          {/* Manual entry: honest-disabled, not a dead-looking live button —
              see components/data-table/bulk-bar.tsx's `disabled`/
              `disabledReason` pattern (task-v3-report.md, "bulk actions:
              real vs disabled"). There is no create-registration RPC or
              Server Action yet (grepped supabase/functions and
              supabase/migrations — nothing named "manual" or
              "create_registration" exists), and a registration created here would need a
              payment_status decision (paid? pending? which method?) with no
              PayMongo transaction behind it. Shipping a wired-looking button
              that silently does nothing would be worse than this. */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} aria-label="Manual entry isn't built yet — there's no create-registration RPC or Server Action.">
                  <Button disabled aria-disabled>
                    <Plus />
                    Manual entry
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Manual entry isn&apos;t built yet — there&apos;s no create-registration RPC or Server Action.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <Suspense key={`kpi-${sectionKey}`} fallback={<KpiRowSkeleton />}>
        <RegistrationsKpiSection eventId={eventId} params={params} />
      </Suspense>

      <div className="mb-3">
        <EventPicker events={events} value={eventId} />
      </div>

      <Suspense key={`table-${sectionKey}`} fallback={<DataTableSkeleton rows={8} columns={6} />}>
        <RegistrationsTableSection eventId={eventId} params={params} />
      </Suspense>
    </div>
  );
}
