import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { getEventSettlement } from "@/lib/queries/settlement";
import { settlementCsv } from "@/lib/settlement-csv";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) {
    return new Response("Forbidden", { status: 403 });
  }
  const { id } = await context.params;
  try {
    // Same caller-scoped read model and tenant check as the page. Never use a service key.
    const settlement = await getEventSettlement(id);
    if (!settlement || (!roles?.isSuperAdmin && settlement.org_id !== roles?.orgId)) {
      return new Response("Not found", { status: 404 });
    }
    const name = settlement.event_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0,100) || "event";
    return new Response(settlementCsv(settlement.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}-settlement.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    // Finish the read before sending headers so a failed query cannot look like a complete CSV.
    return new Response("Could not export settlement. Please try again.", { status: 500 });
  }
}
