import { notFound } from "next/navigation";
import { getMyRoles } from "@/lib/queries/roles";
import { getGuides } from "@/lib/queries/guides";
import { GuideLibrary } from "@/components/guide/GuideLibrary";

export default async function GuidePage() {
  const roles = await getMyRoles();
  if (!roles?.isOrgAdmin) notFound();
  return <GuideLibrary guides={await getGuides()} isSuperAdmin={roles.isSuperAdmin} />;
}
