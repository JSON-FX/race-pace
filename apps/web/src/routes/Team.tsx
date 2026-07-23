import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMyRoles } from "../lib/roles";
import { useOrgMembers, setMemberRole, removeMember, ASSIGNABLE_ROLES, ROLE_LABELS, type OrgMember } from "../lib/team";
import { InviteMemberForm } from "../components/InviteMemberForm";

export function Team() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const qc = useQueryClient();
  const members = useOrgMembers(orgId);
  const [pendingRemove, setPendingRemove] = useState<OrgMember | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function refresh() { qc.invalidateQueries({ queryKey: ["org-members", orgId] }); }

  async function changeRole(m: OrgMember, role: string) {
    if (role === m.role || !orgId) return;
    setRowError(null);
    const res = await setMemberRole(orgId, m.user_id, role);
    if (res.ok) refresh(); else setRowError(res.error ?? "Couldn't change the role.");
  }

  async function confirmRemove() {
    if (!pendingRemove || !orgId) return;
    setRowError(null);
    const res = await removeMember(orgId, pendingRemove.user_id);
    if (res.ok) { setPendingRemove(null); refresh(); }
    else setRowError(res.error ?? "Couldn't remove the member.");
  }

  if (roles.data && !roles.data.isOrgAdmin) {
    return <div style={{ padding: 8, color: "var(--ink-muted)" }}>Team management is available to organization admins only.</div>;
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Team</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, marginBottom: 20 }}>Invite staff and assign their role. Roles decide what they can do across the console and the mobile app.</p>

      {orgId ? <InviteMemberForm orgId={orgId} onInvited={refresh} /> : null}

      <div style={{ marginTop: 24 }}>
        {members.isLoading ? <div style={{ color: "var(--ink-muted)" }}>Loading…</div> : null}
        {members.data?.map((m) => (
          <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--divider)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{m.full_name || m.email || m.user_id}</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{m.email}</div>
            </div>
            <select value={m.role} aria-label={`Role for ${m.email ?? m.user_id}`} onChange={(e) => changeRole(m, e.target.value)}
              style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid var(--hairline)" }}>
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <button onClick={() => { setRowError(null); setPendingRemove(m); }} aria-label={`Remove ${m.email ?? m.user_id}`}
              style={{ color: "var(--danger)", background: "none", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Remove</button>
          </div>
        ))}
        {members.data && members.data.length === 0 ? <div style={{ color: "var(--ink-muted)" }}>No team members yet.</div> : null}
      </div>

      {rowError && !pendingRemove ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{rowError}</div> : null}

      {pendingRemove ? (
        <div role="dialog" aria-label="Confirm remove" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "var(--canvas)", borderRadius: 14, padding: 22, width: 340 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Remove this member?</div>
            <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 16 }}>{pendingRemove.email} loses access to this organization. Their account isn't deleted.</div>
            {rowError ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{rowError}</div> : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setPendingRemove(null); setRowError(null); }} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--hairline)", background: "none", cursor: "pointer" }}>Cancel</button>
              <button onClick={confirmRemove} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--danger)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Remove member</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
