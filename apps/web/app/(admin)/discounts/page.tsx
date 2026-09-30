import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { NoOrgScope } from "@/components/no-org-scope";
import { Button } from "@/components/ui/button";
import { DiscountsWorkspace, type DiscountRecord } from "./workspace";
import type { DiscountPassportOption } from "@/lib/actions/discounts";
export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const roles = await getMyRoles();
  if (!roles?.isOrgAdmin && !roles?.isSuperAdmin) redirect("/no-access");
  const org = requireOrgId(roles);
  if (!org) return <NoOrgScope />;
  const params = await searchParams,
    page = Math.max(1, Number(params.page) || 1);
  const db = await createClient();
  const [codes, events, categories, passports] = await Promise.all([
    db
      .from("admin_discount_codes_v")
      .select("*", { count: "exact" })
      .eq("org_id", org)
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 50, page * 50 - 1),
    db.from("events").select("id,name").eq("org_id", org).order("name"),
    db
      .from("categories")
      .select("id,label,event_id")
      .eq("org_id", org)
      .order("label"),
    db.rpc("discount_passport_options", { p_org: org, p_search: "" }),
  ]);
  if (codes.error || events.error || categories.error || passports.error)
    throw new Error("Discount management is unavailable.");
  const options = passports.data as DiscountPassportOption[];
  return (
    <div
      className="fieldnotes-admin-workspace"
      data-fieldnotes-section="Discounts"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-tight">Discounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entry savings and special invitations, one Passport at a time.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/discounts/export">Export codes</Link>
        </Button>
      </div>
      <DiscountsWorkspace
        codes={codes.data as DiscountRecord[]}
        events={events.data ?? []}
        categories={categories.data ?? []}
        passports={options}
      />
      <nav
        aria-label="Discount pages"
        className="mt-6 flex items-center justify-between"
      >
        <span className="text-sm text-muted-foreground">
          {codes.count ?? 0} codes · Page {page}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Button variant="outline" asChild>
              <Link href={`/discounts?page=${page - 1}`}>Previous</Link>
            </Button>
          )}
          {page * 50 < (codes.count ?? 0) && (
            <Button variant="outline" asChild>
              <Link href={`/discounts?page=${page + 1}`}>Next</Link>
            </Button>
          )}
        </div>
      </nav>
    </div>
  );
}
