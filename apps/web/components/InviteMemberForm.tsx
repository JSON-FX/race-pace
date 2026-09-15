"use client";

import { useActionState, useState } from "react";
import { inviteMemberAction, type TeamState } from "@/lib/actions/team";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/team-roles";
import type { TeamEvent } from "@/lib/queries/team";
import { DeliveryFeedback } from "@/components/DeliveryFeedback";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function InviteMemberForm({
  orgId,
  events = [],
}: {
  orgId: string;
  events?: TeamEvent[];
}) {
  const [state, formAction, pending] = useActionState<TeamState, FormData>(
    inviteMemberAction,
    {},
  );
  // Radix's <Select> isn't a native form control — it needs its own state
  // mirrored into a hidden input so FormData actually carries the role.
  const [role, setRole] = useState<string>("editor");

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="role" value={role} />
      <Input
        type="email"
        name="email"
        placeholder="name@email.com"
        aria-label="Invite email"
        required
        className="min-w-[200px] flex-1"
      />
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger aria-label="Role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ASSIGNABLE_ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(role === "marshal" || role === "claiming") && (
        <select
          name="eventScope"
          aria-label="Event access"
          className="h-9 max-w-60 rounded-lg border bg-background px-2 text-sm"
          defaultValue=""
        >
          <option value="">All organization events</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Inviting…" : "Invite"}
      </Button>
      <DeliveryFeedback state={state} />
    </form>
  );
}
