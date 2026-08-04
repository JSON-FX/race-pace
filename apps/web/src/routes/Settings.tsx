import { useQueryClient } from "@tanstack/react-query";
import { useMyRoles } from "../lib/roles";
import { useMyOrg } from "../lib/org";
import { CropUploader } from "../components/CropUploader";

export function Settings() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const qc = useQueryClient();
  const org = useMyOrg(orgId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-org", orgId] });

  return (
    <div className="max-w-[620px]">
      <h1 className="mb-1 text-[22px] font-bold">Branding</h1>
      <p className="mb-6 text-sm text-muted-foreground">Your organization's avatar and cover photo, shown on the mobile org page.</p>
      {!orgId ? (
        <div className="text-muted-foreground">This account isn't linked to an organization.</div>
      ) : org.isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : org.isError || !org.data ? (
        <div role="alert" className="text-destructive">Couldn't load your organization. Try again.</div>
      ) : (
        <div className="flex flex-col gap-7">
          <CropUploader orgId={orgId} kind="avatar" aspect={1} field="logo_url" label="Avatar" round currentUrl={org.data.logo_url} onSaved={refresh} />
          <CropUploader orgId={orgId} kind="cover" aspect={390 / 150} field="banner_url" label="Cover photo" currentUrl={org.data.banner_url} onSaved={refresh} />
        </div>
      )}
    </div>
  );
}
