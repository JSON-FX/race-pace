import { notFound } from "next/navigation";
import { getEventForEditor } from "@/lib/queries/event-editor";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { EventEditorForm } from "../../event-editor-form";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a Promise in Next 15 and must be awaited.
  const { id } = await params;
  const [data, roles] = await Promise.all([getEventForEditor(id), getMyRoles()]);
  if (!data) notFound();

  return <EventEditorForm initial={data} orgId={requireOrgId(roles)} />;
}
