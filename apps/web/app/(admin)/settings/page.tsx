import { redirect } from "next/navigation";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { getOrg } from "@/lib/queries/org";
import { NoOrgScope } from "@/components/no-org-scope";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const roles = await getMyRoles();
  // See app/(admin)/dashboard/page.tsx's identical guard: the (admin)
  // layout only asserts SOME capability (check_in included), so a marshal
  // clears it — this page must assert manage_org itself, and redirect()
  // rather than notFound().
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");
  // See requireOrgId's doc comment: a bare super_admin clears the (admin)
  // layout's isAdmin guard with orgId: null. Branch before calling any
  // org-scoped query, don't assert the id and let it crash.
  const orgId = requireOrgId(roles);

  if (!orgId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <div className="mb-5">
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Settings</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  const org = await getOrg(orgId);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5">
        <h1 className="text-[21px] font-bold tracking-[-0.02em]">Settings</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Your organization&apos;s profile and branding.</p>
      </div>
      <SettingsForm org={org} canEdit={roles!.isOrgAdmin} />
    </div>
  );
}
