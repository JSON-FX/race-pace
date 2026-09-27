"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { setActiveOrg } from "@/lib/actions/set-active-org";
import type { OrgOption } from "@/lib/org-context";

/**
 * Shows which organization the console is acting as, and — for a super admin
 * only — lets them change it.
 *
 * An org admin gets a plain badge. They have exactly one org, and a menu
 * holding a single already-selected item promises a choice it can't keep.
 * More importantly, cross-org access is a super_admin capability by design
 * (docs/00-product-overview.md §8), so org staff must not even be shown the
 * affordance. The database enforces the same rule independently, and so does
 * the Server Action — this component decides nothing about authorization.
 *
 * State arrives as props from the server (getOrgContext in the (admin) layout)
 * rather than from a client context: the selected org lives in a cookie that
 * Server Components already read while resolving roles, so the first paint is
 * correct with no fetch and no flash of the wrong org.
 */
export function OrgSwitcher({
  availableOrgs,
  activeOrgId,
  isSuperAdmin,
  canSwitch,
}: {
  availableOrgs: OrgOption[];
  activeOrgId: string | null;
  isSuperAdmin: boolean;
  canSwitch: boolean;
}) {
  // The action rewrites a cookie and revalidates the whole layout, so the new
  // org only appears once the server re-renders. A transition keeps the old
  // markup interactive until it does, instead of blanking the shell.
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const active = availableOrgs.find((o) => o.orgId === activeOrgId);

  // A super admin before any org exists — the state the platform starts in,
  // and the one the org-provisioning screens will resolve.
  if (isSuperAdmin && availableOrgs.length === 0) {
    return (
      <Badge variant="secondary" className="">
        Platform · Super admin
      </Badge>
    );
  }

  if (availableOrgs.length === 0) return null;

  if (!canSwitch) {
    return (
      <Badge variant="secondary" className="">
        {active?.name ?? "…"}
      </Badge>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="default"
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={`Organization: ${active?.name ?? "none"}. Switch organization`}
          // min-h-11 (44px) on touch sizes, back to the compact 34px on desktop
          // where a mouse makes the extra height wasted chrome. `max-w` +
          // truncate so a long organization name can't push the header wide —
          // the switcher is the last thing that should cost a sideways scroll.
          className="inline-flex min-h-11 max-w-[55vw] items-center gap-1.5 truncate border px-2.5 py-1.5 disabled:opacity-60 md:min-h-0 md:max-w-none"
          disabled={isPending}
        >
          <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden text-[10px] font-bold uppercase tracking-[0.08em] opacity-80 lg:inline">
            Organization
          </span>
          <span className="truncate">{active?.name ?? "…"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <Command label="Search organizations">
          <CommandInput placeholder="Search organizations…" aria-label="Search organizations" />
          <CommandList className="max-h-[320px] p-1">
            <CommandEmpty>No organizations found.</CommandEmpty>
            {availableOrgs.map(org => <CommandItem key={org.orgId} value={org.orgId} keywords={[org.name]}
              onSelect={() => {
                setOpen(false);
                if (org.orgId !== activeOrgId) startTransition(() => setActiveOrg(org.orgId));
              }} className="gap-3">
              <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              {org.orgId === activeOrgId ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
            </CommandItem>)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
