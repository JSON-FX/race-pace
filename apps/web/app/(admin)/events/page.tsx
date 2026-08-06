import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listOrgEvents } from "@/lib/queries/events";
import { NoOrgScope } from "@/components/no-org-scope";
import { EventsTable } from "./events-table";

const DEFAULTS = { sort: [{ id: "event_date", desc: false }], filters: { status: "all" } };

export default async function EventsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // searchParams is a Promise in Next 15 and must be awaited.
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  // The (admin) layout only guarantees `isAdmin` — a super_admin with no
  // org-scoped admin/editor row clears that guard with `orgId: null`. See
  // requireOrgId's doc comment: querying with a null id 500s, it doesn't
  // just return an empty list, so this must branch before calling
  // listOrgEvents, not assert the id and let it crash.
  const orgId = requireOrgId(roles);

  if (!orgId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <div className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Events</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  const { rows, total } = await listOrgEvents(orgId, params);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Events</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono tabular">{total}</span> event{total === 1 ? "" : "s"} in this organization
          </p>
        </div>
        <Button asChild className="ml-auto">
          <Link href="/events/new"><Plus className="size-4" />New event</Link>
        </Button>
      </div>

      <EventsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q} />
    </div>
  );
}
