import { listOrgPayments, listOrgPaymentMethods } from "@/lib/queries/payments";
import type { TableParams } from "@/lib/table-params";
import { PaymentsTable } from "./payments-table";

/** Rows plus the Method filter's options. The methods list is org-scoped but
 *  deliberately UNfiltered — the filter has to keep offering the other methods
 *  once one is selected. See its doc comment. */
export async function PaymentsTableSection({ orgId, params }: {
  orgId: string;
  params: TableParams;
}) {
  const [{ rows, total }, methods] = await Promise.all([
    listOrgPayments(orgId, params),
    listOrgPaymentMethods(orgId),
  ]);

  return (
    <PaymentsTable
      rows={rows} total={total} page={params.page} per={params.per}
      sort={params.sort} activeFilters={params.filters} q={params.q} methods={methods}
    />
  );
}
