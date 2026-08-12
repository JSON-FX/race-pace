"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setFeeMode } from "@/lib/actions/commission";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type FeeMode = "absorb" | "pass_on";

/**
 * Who bears the payment processor's cut for one organization.
 *
 * Super admin only. This component is the UI half of that rule and NOT the rule
 * itself: `setFeeMode` re-checks `manage_platform` server-side because a Server
 * Action is a public endpoint, and the database refuses the write a third time
 * (20260811097000's BEFORE UPDATE trigger) because `organizations`' org-admin
 * UPDATE policy is column-agnostic and cannot tell fee_mode from a logo.
 *
 * Optimistic on the local value, not on the outcome: the <Select> shows the new
 * mode immediately so it does not feel stuck, and reverts if the action refuses.
 * A control that snaps back with a reason is honest; one that silently keeps
 * displaying a mode the database rejected is the failure this whole task is
 * about.
 */
export function FeeModeSelect({
  orgId, orgName, mode,
}: { orgId: string; orgName: string; mode: FeeMode }) {
  const [value, setValue] = useState<FeeMode>(mode);
  const [pending, start] = useTransition();

  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(next) => {
        const chosen = next as FeeMode;
        const previous = value;
        setValue(chosen);
        start(async () => {
          const res = await setFeeMode(orgId, chosen);
          if (res?.error) {
            setValue(previous);
            toast.error(res.error);
          } else if (res?.success) {
            toast.success(res.success);
          }
        });
      }}
    >
      <SelectTrigger size="sm" className="w-[188px] rounded-pill" aria-label={`Fee mode for ${orgName}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {/* Labelled by WHO PAYS, not by the column's values. "absorb"/"pass_on"
            are written from the organizer's point of view and read backwards to
            an operator thinking about the runner's checkout total. */}
        <SelectItem value="absorb">Absorb · org pays fees</SelectItem>
        <SelectItem value="pass_on">Pass on · runner pays fees</SelectItem>
      </SelectContent>
    </Select>
  );
}
