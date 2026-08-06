import { notFound } from "next/navigation";
import { getEventForEditor } from "@/lib/queries/event-editor";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { EventEditorForm } from "../../event-editor-form";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a Promise in Next 15 and must be awaited.
  const { id } = await params;
  const [data, roles] = await Promise.all([getEventForEditor(id), getMyRoles()]);
  if (!data) notFound();

  // getEventForEditor has no org filter of its own — it can load ANY
  // non-draft event (events_read_published: `using (status <> 'draft')`
  // admits any authenticated caller, not just the owning org's admins/
  // editors). Without this check, an editor of org A who pastes org B's
  // event id gets a fully populated, editable form for org B's race, with
  // no error until they hit Save. A super_admin can admin any org (see
  // lib/actions/events.ts's assertCanWriteEvent for the same rule on the
  // write side), so only a resolved-org mismatch for a non-super-admin 404s.
  if (!roles?.isSuperAdmin && data.event.org_id !== roles?.orgId) notFound();

  return <EventEditorForm initial={data} orgId={requireOrgId(roles)} />;
}
