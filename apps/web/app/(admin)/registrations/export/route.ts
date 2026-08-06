import { parseTableParams, searchParamsToRecord, type TableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listEventRegistrations, listOrgEventOptions } from "@/lib/queries/registrations";
import { csvField, csvRow, centavosToDecimal } from "@/lib/csv";

export const dynamic = "force-dynamic";

// Mirrors the page's own defaults (app/(admin)/registrations/page.tsx) —
// MUST stay identical, or a request with no `status`/`category` in the URL
// would filter differently here than the page it's meant to mirror.
const DEFAULTS = { sort: [{ id: "created_at", desc: true }], filters: { status: "all", category: "all" } };

// Matches PGRST_DB_MAX_ROWS on this instance — confirmed live via
// `docker inspect supabase_rest_race-pace` (env var PGRST_DB_MAX_ROWS=1000),
// not guessed, and cross-checked against supabase/config.toml's
// `max_rows = 1000`. PostgREST silently caps any single request at this
// many rows regardless of what `.range()` asks for, so paging in batches of
// exactly this size is both the largest batch possible and the smallest
// number of round trips — a smaller batch only adds requests, a larger one
// gets silently truncated by PostgREST rather than erroring, which is the
// exact failure mode ("page 1 looks like the whole export") this route
// exists to avoid.
const BATCH = 1000;

const HEADER = [
  "Registration ID",
  "Runner",
  "Email",
  "Category",
  "Bib",
  "Registered At (UTC)",
  "Amount (PHP)",
  "Payment Status",
  "Payment Method",
];

function toRow(r: Awaited<ReturnType<typeof listEventRegistrations>>["rows"][number]): string {
  return csvRow([
    csvField(r.id),
    csvField(r.full_name),
    csvField(r.email),
    csvField(r.category_label),
    csvField(r.bib_name),
    // ISO 8601, unambiguous — not the table's `MMM D, HH:mm` (see fmtDateTime
    // in @/lib/format), which is fine for a narrow on-screen date column but
    // ambiguous once it leaves the app (no year, no explicit timezone) and
    // isn't sortable as text the way ISO is.
    new Date(r.created_at).toISOString(),
    centavosToDecimal(r.total_amount),
    csvField(r.payment_status),
    csvField(r.payment_method),
  ]);
}

/**
 * Streams every registration matching the CURRENT filters (not just the
 * visible page) as CSV. Reuses `parseTableParams` and `listEventRegistrations`
 * — the exact same parser and query builder the page itself uses — so this
 * can never silently diverge from what's on screen the way a second,
 * hand-rolled filter implementation could (see the KPI-row RPC drift this
 * project already hit once, docs/superpowers/specs/2026-08-06-admin-visual-
 * parity-spec.md, "KPI row").
 *
 * Runs under the caller's own session (`createClient()` from
 * @/lib/supabase/server, inside listEventRegistrations) so RLS applies —
 * `admin_registrations_v` is `security_invoker`, and org isolation depends
 * entirely on that. This route must NEVER switch to a service-role client:
 * doing so would return every organization's registrant PII to whoever
 * hits this URL, not just the caller's own org.
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

  // Same event-scope resolution as the page (app/(admin)/registrations/
  // page.tsx): an explicit `?event=` wins, otherwise fall back to the org's
  // most recent event so a bare `/registrations/export` (no query at all)
  // exports the same event the page would have defaulted to rendering.
  const events = await listOrgEventOptions(orgId);
  const eventId =
    params.filters.event && params.filters.event !== "all" ? params.filters.event : events[0]?.id;

  const filename = `registrations-${new Date().toISOString().slice(0, 10)}.csv`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvRow(HEADER)));

        if (!eventId) {
          // No events in this org at all — the page renders its own empty
          // state in this case; the export mirrors it with a header-only CSV
          // rather than erroring.
          controller.close();
          return;
        }

        // `page`/`per` from the incoming request are deliberately ignored
        // from here down — ignore params.page/params.per entirely and page
        // through the FULL filtered set in fixed BATCH-sized chunks instead,
        // per the "export the whole filtered set, not the visible page"
        // requirement. A naive single `listEventRegistrations(eventId,
        // params)` call would silently truncate at PostgREST's cap the same
        // way an un-paged `.range()` read would.
        let page = 1;
        for (;;) {
          const batchParams: TableParams = { ...params, page, per: BATCH };
          const { rows, total } = await listEventRegistrations(eventId, batchParams);
          for (const row of rows) controller.enqueue(encoder.encode(toRow(row)));
          if (rows.length === 0 || page * BATCH >= total) break;
          page += 1;
        }
        controller.close();
      } catch (err) {
        // Headers (200 + CSV content-type) are already flushed by the time
        // any query in the loop above can fail, so there is no "fail with a
        // 500" option left — erroring the stream truncates the download,
        // which is at least honest about something having gone wrong rather
        // than silently emitting a partial file that looks complete.
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
