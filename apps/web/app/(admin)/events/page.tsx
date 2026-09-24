import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { listOrgEvents } from "@/lib/queries/events";
import { NoOrgScope } from "@/components/no-org-scope";
import { EventsTable } from "./events-table";
import "./fieldnotes.css";

const DEFAULTS = { sort: [{ id: "event_date", desc: false }], filters: { status: "all" } };

export default async function EventsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // searchParams is a Promise in Next 15 and must be awaited.
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  // The (admin) layout only asserts SOME capability (check_in included, so
  // /check-in stays reachable for a marshal) — see dashboard/page.tsx's
  // identical guard for why this and every other manage_org page must
  // assert manage_org itself, and redirect() rather than notFound().
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");
  // The (admin) layout only guarantees `isAdmin` — a super_admin with no
  // org-scoped admin/editor row clears that guard with `orgId: null`. See
  // requireOrgId's doc comment: querying with a null id 500s, it doesn't
  // just return an empty list, so this must branch before calling
  // listOrgEvents, not assert the id and let it crash.
  const orgId = requireOrgId(roles);

  if (!orgId) {
    return (
      <div className="fieldnotes-admin-events">
        <div className="fieldnotes-admin-events__inner">
          <p className="fieldnotes-admin-events__eyebrow">Race control / Events</p>
          <h1>Events</h1>
          <p className="fieldnotes-admin-events__description">Plan and manage races for your organization.</p>
          <div className="fieldnotes-admin-events__content"><NoOrgScope /></div>
        </div>
      </div>
    );
  }

  // Caught here (rather than left to throw into error.tsx) so a transient
  // DB blip degrades gracefully: the header, count text and "New event"
  // button stay usable, and only the table area shows a retryable inline
  // error (DataTable's `isError` — see that prop's doc comment). Nothing
  // else on this page depends on `listOrgEvents`, unlike Registrations/
  // Payments where the table query and the KPI aggregates are batched
  // together in one `Promise.all` and a partial "table failed, KPIs fine"
  // state isn't something today's query shape can express — those still
  // fall through to app/(admin)/error.tsx on a query failure.
  let rows: Awaited<ReturnType<typeof listOrgEvents>>["rows"] = [];
  let total = 0;
  let isError = false;
  try {
    ({ rows, total } = await listOrgEvents(orgId, params));
  } catch (error) {
    console.error("[events] listOrgEvents failed", { orgId, error });
    isError = true;
  }

  return (
    <div className="fieldnotes-admin-events">
      <div className="fieldnotes-admin-events__inner">
        <p className="fieldnotes-admin-events__eyebrow">Race control / Events</p>
        <div className="fieldnotes-admin-events__heading">
          <div>
            <h1>Events</h1>
            <p className="fieldnotes-admin-events__description">Plan, publish, and manage every race in your organization.</p>
          </div>
          <Button asChild className="fieldnotes-admin-events__new">
            <Link href="/events/new"><Plus className="size-4" />New event</Link>
          </Button>
        </div>
        <div className="fieldnotes-admin-events__content">
          <div className="fieldnotes-admin-events__section-heading">
            <div>
              <h2>Event directory</h2>
              <p><span className="tabular">{total}</span> event{total === 1 ? "" : "s"} in this organization</p>
            </div>
            <span aria-hidden="true">01 / Directory</span>
          </div>
          <EventsTable rows={rows} total={total} page={params.page} per={params.per}
            sort={params.sort} activeFilters={params.filters} q={params.q}
            canWrite={!!roles?.isAdmin} isError={isError} />
        </div>
      </div>
    </div>
  );
}
