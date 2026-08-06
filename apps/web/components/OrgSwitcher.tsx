"use client";

import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

  const active = availableOrgs.find((o) => o.orgId === activeOrgId);

  // A super admin before any org exists — the state the platform starts in,
  // and the one the org-provisioning screens will resolve.
  if (isSuperAdmin && availableOrgs.length === 0) {
    return (
      <Badge variant="secondary" className="text-[13px] font-semibold">
        Platform · Super admin
      </Badge>
    );
  }

  if (availableOrgs.length === 0) return null;

  if (!canSwitch) {
    return (
      <Badge variant="secondary" className="text-[13px] font-semibold">
        {active?.name ?? "…"}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Organization: ${active?.name ?? "none"}. Switch organization`}
          // min-h-11 (44px) on touch sizes, back to the compact 34px on desktop
          // where a mouse makes the extra height wasted chrome. `max-w` +
          // truncate so a long organization name can't push the header wide —
          // the switcher is the last thing that should cost a sideways scroll.
          className="inline-flex min-h-11 max-w-[42vw] items-center gap-1.5 truncate rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[13px] font-semibold text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-60 md:min-h-0 md:max-w-none"
          disabled={isPending}
        >
          {active?.name ?? "…"}
          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] min-w-[240px] overflow-y-auto">
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Viewing as super admin
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableOrgs.map((o) => (
          <DropdownMenuItem
            key={o.orgId}
            onSelect={() => startTransition(() => setActiveOrg(o.orgId))}
            className="flex items-center justify-between gap-3"
          >
            <span className="font-medium">{o.name}</span>
            {o.orgId === activeOrgId ? (
              <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
