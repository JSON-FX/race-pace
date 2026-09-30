import { createClient } from "@/lib/supabase/server";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { csvRow, csvField, centavosToDecimal } from "@/lib/csv";
export async function GET() {
  const roles = await getMyRoles(),
    org = requireOrgId(roles);
  if (!org || (!roles?.isOrgAdmin && !roles?.isSuperAdmin))
    return new Response("Forbidden", { status: 403 });
  const db = await createClient(),
    encoder = new TextEncoder();
  let page = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (!page)
          controller.enqueue(
            encoder.encode(
              csvRow([
                "Code",
                "Type",
                "Discount type",
                "Value",
                "Coverage",
                "Scope",
                "Absorb fees",
                "Passport ID",
                "Limit",
                "Reserved",
                "Redeemed",
                "Active",
                "Starts (UTC)",
                "Ends (UTC)",
              ]),
            ),
          );
        const result = await db
          .from("admin_discount_codes_v")
          .select("*")
          .eq("org_id", org)
          .order("created_at")
          .order("id")
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (result.error) throw result.error;
        controller.enqueue(
          encoder.encode(
            result.data
              .map((r) =>
                csvRow([
                  csvField(r.code),
                  csvField(r.kind),
                  csvField(r.discount_type),
                  centavosToDecimal(r.value),
                  csvField(r.coverage),
                  csvField(r.scope),
                  String(r.absorb_fees),
                  csvField(r.assigned_passport_id),
                  String(r.max_uses ?? "Unlimited"),
                  String(r.reserved),
                  String(r.redeemed),
                  String(r.active),
                  csvField(r.starts_at),
                  csvField(r.ends_at),
                ]),
              )
              .join(""),
          ),
        );
        page++;
        if (result.data.length < 1000) controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="discount-codes.csv"',
      "cache-control": "no-store",
    },
  });
}
