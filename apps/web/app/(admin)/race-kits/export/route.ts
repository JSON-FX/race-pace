import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { csvField, csvRow } from "@/lib/csv";
import { kitState, type KitRow } from "@/lib/kit-release";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const roles = await getMyRoles();
  if (!roles?.capabilities.includes("release_kits"))
    return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url),
    event = url.searchParams.get("event"),
    q = url.searchParams.get("q") ?? "",
    state = url.searchParams.get("state") ?? "all";
  if (
    !event ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(event) ||
    !["all", "released", "unreleased"].includes(state)
  )
    return new Response("Invalid filters", { status: 400 });
  const db = await createClient();
  const allowed = await db.rpc("kit_release_events").eq("id", event);
  if (allowed.error)
    return new Response("Unable to check event access", { status: 503 });
  if (!allowed.data?.length) return new Response("Forbidden", { status: 403 });
  // Buffer before responding so a failed later batch cannot look like a complete CSV.
  const lines = [
    csvRow([
      "Registration ID",
      "Runner",
      "Bib name",
      "Category",
      "Shirt size",
      "Add-ons",
      "Kit status",
      "Released at (UTC)",
      "Released by",
      "Recipient",
    ]),
  ];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .rpc("kit_release_roster", {
        p_event_id: event,
        p_query: q,
        p_state: state,
      })
      .range(offset, offset + 999);
    if (error)
      return new Response("Export failed. Please retry.", { status: 503 });
    for (const row of (data ?? []) as KitRow[])
      lines.push(
        csvRow(
          [
            row.registration_id,
            row.runner,
            row.bib,
            row.category,
            row.kit.shirt_size,
            row.kit.addons.map((a) => a.name).join("; "),
            kitState(row),
            row.released_at,
            row.released_by,
            row.recipient_name,
          ].map(csvField),
        ),
      );
    if ((data ?? []).length < 1000) break;
  }
  return new Response("\uFEFF" + lines.join(""), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="race-kits-${event}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
