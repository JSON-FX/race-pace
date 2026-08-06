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
import { useOrgContext } from "../lib/orgContext";

/**
 * Shows which organization the console is acting as, and — for a super admin
 * only — lets them change it.
 *
 * An org admin gets a plain badge. They have exactly one org, and a menu
 * holding a single already-selected item promises a choice it can't keep.
 * More importantly, cross-org access is a super_admin capability by design
 * (docs/00-product-overview.md §8), so org staff must not even be shown the
 * affordance. The database enforces the same rule independently.
 */
export function OrgSwitcher() {
  const { availableOrgs, activeOrgId, activeRole, isSuperAdmin, canSwitch, setActiveOrg } = useOrgContext();

  const active = availableOrgs.find((o) => o.orgId === activeOrgId);

  // A super admin before any org exists — the state the platform starts in,
  // and the one the org-provisioning screens will resolve.
  if (isSuperAdmin && availableOrgs.length === 0) {
    return (
      <Badge variant="secondary" className="ml-auto text-[13px] font-semibold">
        Platform · Super admin
      </Badge>
    );
  }

  if (availableOrgs.length === 0) return null;

  if (!canSwitch) {
    return (
      <Badge variant="secondary" className="ml-auto text-[13px] font-semibold">
        {active?.name ?? "…"}
        {activeRole && activeRole !== "admin" ? (
          <span className="ml-1.5 font-normal capitalize opacity-70">· {activeRole}</span>
        ) : null}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Organization: ${active?.name ?? "none"}. Switch organization`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[13px] font-semibold text-secondary-foreground transition-colors hover:bg-accent"
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
            onSelect={() => setActiveOrg(o.orgId)}
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
