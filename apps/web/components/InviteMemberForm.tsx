"use client";

import { useActionState, useState } from "react";
import { inviteMemberAction, type TeamState } from "@/lib/actions/team";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/team-roles";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function InviteMemberForm({ orgId }: { orgId: string }) {
  const [state, formAction, pending] = useActionState<TeamState, FormData>(inviteMemberAction, {});
  // Radix's <Select> isn't a native form control — it needs its own state
  // mirrored into a hidden input so FormData actually carries the role.
  const [role, setRole] = useState<string>("editor");

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="role" value={role} />
      <Input
        type="email" name="email" placeholder="name@email.com" aria-label="Invite email" required
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
      <Button type="submit" disabled={pending}>
        {pending ? "Inviting…" : "Invite"}
      </Button>
      {state.error ? <div role="alert" className="basis-full text-[13px] text-destructive">{state.error}</div> : null}
      {state.success ? <div className="basis-full text-[13px] text-muted-foreground">{state.success}</div> : null}
    </form>
  );
}
