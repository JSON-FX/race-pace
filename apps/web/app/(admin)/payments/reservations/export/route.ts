import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { csvField, csvRow, centavosToDecimal } from "@/lib/csv";
import { listReservationPayments } from "@/lib/queries/reservation-payments";
import { filterReservationPayments } from "@/lib/reservation-payment-filters";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) return new Response(null, { status: 403 });
  const orgId = requireOrgId(roles);
  if (!orgId) return new Response(null, { status: 403 });
  const params = new URL(request.url).searchParams;
  const eventId = params.get("event") ?? undefined;
  if (eventId && !UUID.test(eventId)) return new Response(null, { status: 400 });
  const search = params.get("q")?.trim() ?? "";
  const method = params.get("method") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (search.length > 100 || method.length > 100 || (from && !date.test(from)) ||
    (to && !date.test(to)) || (from && to && from > to)) return new Response(null, { status: 400 });
  try {
    const rows = filterReservationPayments(await listReservationPayments(orgId, eventId), { search, method, from, to });
    const header = csvRow(["Reservation payment ID", "Event", "Runner name", "Runner email", "Paid at (UTC)",
      "Method", "Gross (PHP)", "Platform Fees (PHP)", "PayMongo fee (PHP)", "Net to organizer (PHP)"]);
    const body = rows.map((row) => csvRow([
      csvField(row.id), csvField(row.event_name), csvField(row.runner_name), csvField(row.runner_email),
      row.paid_at ? new Date(row.paid_at).toISOString() : "", csvField(row.method),
      centavosToDecimal(row.amount_cents), centavosToDecimal(row.platform_fee_cents),
      centavosToDecimal(row.processor_fee_cents), centavosToDecimal(row.net_to_org_cents),
    ])).join("");
    return new Response(header + body, { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reservation-payments-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
