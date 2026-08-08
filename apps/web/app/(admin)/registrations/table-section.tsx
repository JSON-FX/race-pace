import { listEventRegistrations, listEventCategories } from "@/lib/queries/registrations";
import type { TableParams } from "@/lib/table-params";
import { RegistrationsTable } from "./registrations-table";

/** Rows + the category filter's options, split out of page.tsx so the page
 *  shell and event picker can paint before either lands. These two are fetched
 *  together (not in separate boundaries) because a table whose category filter
 *  arrives after its rows would let an operator act on a half-built toolbar. */
export async function RegistrationsTableSection({ eventId, params }: {
  eventId: string;
  params: TableParams;
}) {
  const [{ rows, total }, categories] = await Promise.all([
    listEventRegistrations(eventId, params),
    listEventCategories(eventId),
  ]);

  return (
    <RegistrationsTable
      rows={rows} total={total} page={params.page} per={params.per}
      sort={params.sort} activeFilters={params.filters} q={params.q} categories={categories}
    />
  );
}
