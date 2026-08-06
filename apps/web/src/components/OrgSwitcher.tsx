import { useQuery } from "@tanstack/react-query";
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
import { supabase } from "../lib/supabase";
import { useOrgContext } from "../lib/orgContext";

/**
 * Picks which organization the console is acting as.
 *
 * With exactly one membership this renders as a plain badge, not a dropdown —
 * a control whose menu holds a single already-selected item is a promise of
 * choice the UI can't keep.
 */
export function OrgSwitcher({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { memberships, activeOrgId, setActiveOrg } = useOrgContext();

  // One request for every org the user administers, rather than one per row —
  // the switcher needs all the names up front to render the menu anyway.
  const ids = memberships.map((m) => m.orgId);
  const names = useQuery({
    queryKey: ["org-names", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id,name").in("id", ids);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((o) => [o.id as string, o.name as string]));
    },
  });

  if (isSuperAdmin && memberships.length === 0) {
    return (
      <Badge variant="secondary" className="ml-auto text-[13px] font-semibold">
        Platform · Super admin
      </Badge>
    );
  }

  if (memberships.length === 0) return null;

  const label = (id: string | null) => (id ? names.data?.[id] ?? "…" : "…");

  if (memberships.length === 1) {
    return (
      <Badge variant="secondary" className="ml-auto text-[13px] font-semibold">
        {label(activeOrgId)}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Organization: ${label(activeOrgId)}. Switch organization`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[13px] font-semibold text-secondary-foreground transition-colors hover:bg-accent"
        >
          {label(activeOrgId)}
          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Switch organization
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Alphabetical by name for the reader; the underlying membership
            order stays id-ordered so the DEFAULT org is deterministic. */}
        {[...memberships]
          .sort((a, b) => label(a.orgId).localeCompare(label(b.orgId)))
          .map((m) => (
          <DropdownMenuItem
            key={m.orgId}
            onSelect={() => setActiveOrg(m.orgId)}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex flex-col">
              <span className="font-medium">{label(m.orgId)}</span>
              <span className="text-[11px] capitalize text-muted-foreground">{m.role}</span>
            </span>
            {m.orgId === activeOrgId ? (
              <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
