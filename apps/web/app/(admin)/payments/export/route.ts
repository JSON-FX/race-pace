import { parseTableParams, searchParamsToRecord, type TableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listOrgPayments } from "@/lib/queries/payments";
import { csvField, csvRow, centavosToDecimal } from "@/lib/csv";

export const dynamic = "force-dynamic";

// Mirrors the page's own defaults (app/(admin)/payments/page.tsx) — MUST
// stay identical, or a request with no `status`/`method` in the URL would
// filter differently here than the page it's meant to mirror.
const DEFAULTS = { sort: [{ id: "created_at", desc: true }], filters: { status: "all", method: "all" } };

// See the identical constant + comment in
// app/(admin)/registrations/export/route.ts — same instance, same measured
// PGRST_DB_MAX_ROWS=1000, same reasoning for why the batch size equals it.
const BATCH = 1000;

const HEADER = [
  "Registration ID",
  "Event",
  "Runner",
  "Amount (PHP)",
  "Platform Fee (PHP)",
  "Net to Org (PHP)",
  "Method",
  "Status",
  "Date (UTC)",
];

function toRow(r: Awaited<ReturnType<typeof listOrgPayments>>["rows"][number]): string {
  return csvRow([
    csvField(r.registration_id),
    csvField(r.event_name),
    csvField(r.full_name),
    // Money as plain decimals, consistent with the Registrations export —
    // see centavosToDecimal's doc comment (@/lib/csv) for why a raw number
    // beats a formatted `₱` string in a spreadsheet.
    centavosToDecimal(r.amount),
    centavosToDecimal(r.platform_fee),
    centavosToDecimal(r.net_to_org),
    csvField(r.method),
    csvField(r.status),
    // ISO 8601 — see the same choice in the Registrations export's toRow.
    new Date(r.created_at).toISOString(),
  ]);
}

/**
 * Streams every payment matching the CURRENT filters (not just the visible
 * page) as CSV. Reuses `parseTableParams` and `listOrgPayments` — the exact
 * same parser and query builder the page itself uses — so the export can
 * never silently diverge from what's on screen.
 *
 * Runs under the caller's own session (`createClient()` from
 * @/lib/supabase/server, inside listOrgPayments) so RLS applies —
 * `admin_payments_v` is `security_invoker`, and org isolation depends
 * entirely on that. This route must NEVER switch to a service-role client.
 */
export async function GET(request: Request) {
  const roles = await getMyRoles();
  const orgId = requireOrgId(roles);
  if (!orgId) {
    return new Response(JSON.stringify({ error: "No organization on this account." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const params = parseTableParams(searchParamsToRecord(url.searchParams), DEFAULTS);

  const filename = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvRow(HEADER)));

        // `page`/`per` from the incoming request are deliberately ignored —
        // page through the FULL filtered set in fixed BATCH-sized chunks
        // instead, per the "export the whole filtered set" requirement.
        let page = 1;
        for (;;) {
          const batchParams: TableParams = { ...params, page, per: BATCH };
          const { rows, total } = await listOrgPayments(orgId, batchParams);
          for (const row of rows) controller.enqueue(encoder.encode(toRow(row)));
          if (rows.length === 0 || page * BATCH >= total) break;
          page += 1;
        }
        controller.close();
      } catch (err) {
        // Headers are already flushed by the time a query in the loop above
        // can fail — erroring the stream truncates the download rather than
        // silently emitting a partial file that looks complete.
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
