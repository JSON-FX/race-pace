import { redirect } from "next/navigation";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { NoOrgScope } from "@/components/no-org-scope";
import { EventEditorForm } from "../event-editor-form";

export default async function NewEventPage() {
  const roles = await getMyRoles();
  // See app/(admin)/dashboard/page.tsx's identical guard: the (admin)
  // layout only asserts SOME capability (check_in included), so a marshal
  // clears it — this page must assert manage_org itself, and redirect()
  // rather than notFound().
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");
  const orgId = requireOrgId(roles);

  // See app/(admin)/events/page.tsx's identical guard: a super_admin with no
  // org-scoped admin/editor row clears the (admin) layout's isAdmin check
  // but has no organization to create an event in.
  if (!orgId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <div className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">New event</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  return <EventEditorForm initial={null} orgId={orgId} />;
}
