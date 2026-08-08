import Link from "next/link";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { parseTableParams, serializeTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listOrgEventOptions } from "@/lib/queries/registrations";
import { DataTableSkeleton } from "@/components/data-table";
import { NoOrgScope } from "@/components/no-org-scope";
import { KpiRowSkeleton } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { PaymentsEventPicker } from "./event-picker";
import { ALL_EVENTS } from "./constants";
import { PaymentsKpiSection } from "./kpi-section";
import { PaymentsTableSection } from "./table-section";

const DEFAULTS = {
  sort: [{ id: "created_at", desc: true }],
  filters: { status: "all", method: "all", event: "all" },
};

export default async function PaymentsPage({
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
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Payments</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  // Only the event list is needed before the shell can paint — the picker
  // renders from it and the subtitle names the active event. Rows, methods and
  // aggregates have moved into the suspended sections below.
  const events = await listOrgEventOptions(orgId);

  const activeEvent = params.filters.event ?? ALL_EVENTS;

  const exportHref = `/payments/export?${serializeTableParams({ ...params, page: 1 }, DEFAULTS)}`;

  // Keying both boundaries on the resolved params is what makes a skeleton
  // appear on a searchParams-only navigation. `loading.tsx` fires only when the
  // route SEGMENT changes, so switching event, paging, sorting or filtering
  // otherwise leaves the old table on screen with no indication anything is
  // happening. Changing the key remounts the boundary, which re-shows the
  // fallback. Reuses serializeTableParams so the key can never drift from the
  // params the sections are actually handed.
  const sectionKey = serializeTableParams({ ...params }, DEFAULTS).toString();

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Payments</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {activeEvent !== ALL_EVENTS ? (
              // Name the scope in words next to the cards. The KPI cards change
              // silently otherwise, and "₱2,100 gross" for one event looks
              // identical to "₱2,100 gross" for the whole organization.
              <>Showing <span className="font-semibold text-foreground">
                {events.find((e) => e.id === activeEvent)?.name ?? "this event"}
              </span></>
            ) : "Across all events"}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <PaymentsEventPicker events={events} value={activeEvent} />
        <Button variant="outline" asChild>
          <Link href={exportHref}>
            <Download />
            Export CSV
          </Link>
        </Button>
        </div>
      </div>

      <Suspense key={`kpi-${sectionKey}`} fallback={<KpiRowSkeleton />}>
        <PaymentsKpiSection orgId={orgId} params={params} />
      </Suspense>

      <Suspense key={`table-${sectionKey}`} fallback={<DataTableSkeleton rows={8} columns={6} />}>
        <PaymentsTableSection orgId={orgId} params={params} />
      </Suspense>
    </div>
  );
}
