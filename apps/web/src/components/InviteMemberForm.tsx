import { useState, type FormEvent } from "react";
import { ASSIGNABLE_ROLES, ROLE_LABELS, inviteMember } from "../lib/team";

export function InviteMemberForm({ orgId, onInvited }: { orgId: string; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const res = await inviteMember(orgId, email.trim(), role);
    setBusy(false);
    if (res.ok) { setEmail(""); onInvited(); }
    else setError(res.error ?? "Couldn't send the invite.");
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="name@email.com" aria-label="Invite email"
        style={{ flex: 1, minWidth: 200, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--hairline)" }}
      />
      <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"
        style={{ padding: "9px 11px", borderRadius: 8, border: "1px solid var(--hairline)" }}>
        {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
      <button type="submit" disabled={busy}
        style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
        {busy ? "Inviting…" : "Invite"}
      </button>
      {error ? <div role="alert" style={{ flexBasis: "100%", color: "var(--danger)", fontSize: 13 }}>{error}</div> : null}
    </form>
  );
}
