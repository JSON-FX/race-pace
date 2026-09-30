import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { peso } from "@/lib/format";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
export default async function DiscountHistory({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const roles = await getMyRoles();
  if (!roles?.isOrgAdmin && !roles?.isSuperAdmin) redirect("/no-access");
  const org = requireOrgId(roles);
  if (!org) notFound();
  const { id } = await params,
    page = Math.max(1, Number((await searchParams).page) || 1),
    db = await createClient();
  const code = await db
    .from("discount_codes")
    .select("code,assigned_passport_id")
    .eq("id", id)
    .eq("org_id", org)
    .maybeSingle();
  if (!code.data) notFound();
  const history = await db
    .from("discount_redemptions")
    .select(
      "id,registration_id,passport_id,state,original_cents,discount_cents,created_at,registrations(custom_data,event_id)",
      { count: "exact" },
    )
    .eq("code_id", id)
    .eq("org_id", org)
    .order("created_at", { ascending: false })
    .range((page - 1) * 50, page * 50 - 1);
  if (history.error) throw new Error("Usage history is unavailable.");
  return (
    <div className="fieldnotes-admin-workspace">
      <Link className="text-sm text-primary hover:underline" href="/discounts">
        Back to Discounts
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{code.data.code}</h1>
      <p className="mb-6 mt-2 text-sm text-muted-foreground">
        Usage history · {history.count ?? 0} attempts
        {code.data.assigned_passport_id
          ? ` · Assigned Passport ${code.data.assigned_passport_id}`
          : ""}
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <Table className="w-full text-left text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              {["Passport", "State", "Original", "Discount", "Date"].map(
                (h) => (
                  <TableHead key={h} className="px-4 py-3">
                    {h}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data.map((row) => {
              const registration = Array.isArray(row.registrations)
                ? row.registrations[0]
                : row.registrations;
              return (
                <TableRow key={row.id} className="border-t">
                  <TableCell className="px-4 py-4">
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      href={`/registrations?event=${registration?.event_id ?? ""}&reg=${row.registration_id}`}
                    >
                      {String(
                        registration?.custom_data?.full_name ?? row.passport_id,
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 py-4 capitalize">
                    {row.state}
                  </TableCell>
                  <TableCell className="px-4 py-4 tabular-nums">
                    {peso(row.original_cents)}
                  </TableCell>
                  <TableCell className="px-4 py-4 tabular-nums">
                    {peso(row.discount_cents)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-4">
                    {new Intl.DateTimeFormat("en-PH", {
                      timeZone: "Asia/Manila",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(row.created_at))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!history.data.length && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No one has used this code yet.
          </p>
        )}
      </div>
      <div className="mt-5 flex gap-3">
        {page > 1 && (
          <Button variant="outline" asChild>
            <Link href={`?page=${page - 1}`}>Previous</Link>
          </Button>
        )}
        {page * 50 < (history.count ?? 0) && (
          <Button variant="outline" asChild>
            <Link href={`?page=${page + 1}`}>Next</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
