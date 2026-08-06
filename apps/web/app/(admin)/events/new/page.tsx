import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { NoOrgScope } from "@/components/no-org-scope";
import { EventEditorForm } from "../event-editor-form";

export default async function NewEventPage() {
  const roles = await getMyRoles();
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
