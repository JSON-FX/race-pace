import { useState, type FormEvent } from "react";
import { ASSIGNABLE_ROLES, ROLE_LABELS, inviteMember } from "../lib/team";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

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
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
      <Input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="name@email.com" aria-label="Invite email"
        className="min-w-[200px] flex-1"
      />
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger aria-label="Role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ASSIGNABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={busy}>
        {busy ? "Inviting…" : "Invite"}
      </Button>
      {error ? <div role="alert" className="basis-full text-[13px] text-destructive">{error}</div> : null}
    </form>
  );
}
