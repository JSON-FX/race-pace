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
    <div style={{ maxWidth: 620 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Branding</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, marginBottom: 24 }}>Your organization's avatar and cover photo, shown on the mobile org page.</p>
      {!orgId ? (
        <div style={{ color: "var(--ink-muted)" }}>This account isn't linked to an organization.</div>
      ) : org.isLoading ? (
        <div style={{ color: "var(--ink-muted)" }}>Loading…</div>
      ) : org.isError || !org.data ? (
        <div role="alert" style={{ color: "var(--danger)" }}>Couldn't load your organization. Try again.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <CropUploader orgId={orgId} kind="avatar" aspect={1} field="logo_url" label="Avatar" round currentUrl={org.data.logo_url} onSaved={refresh} />
          <CropUploader orgId={orgId} kind="cover" aspect={390 / 150} field="banner_url" label="Cover photo" currentUrl={org.data.banner_url} onSaved={refresh} />
        </div>
      )}
    </div>
  );
}
