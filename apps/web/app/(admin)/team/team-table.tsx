"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type FilterDef } from "@/components/data-table";
import { changeRoleAction } from "@/lib/actions/team";
import type { TeamMember } from "@/lib/queries/team";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/team-roles";
import type { SortState } from "@/lib/table-params";

const ROLE_FILTER: FilterDef = {
  key: "role",
  label: "Role",
  options: ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
};

function initials(member: TeamMember): string {
  const source = member.full_name ?? member.email ?? "??";
  return source.slice(0, 2).toUpperCase();
}

/**
 * The org-members edge function is the real authorization boundary — it
 * can (and does, see the last-admin guard) reject a role change the UI
 * optimistically allowed. A Radix <Select> with `defaultValue` is
 * uncontrolled: once the user picks an option it shows that pick until the
 * component remounts, regardless of whether the mutation actually
 * succeeded. Without this, a rejected change (e.g. demoting an org's last
 * admin) would leave the dropdown silently showing the wrong role until
 * the admin manually reloads the page. Controlling it and reverting to the
 * previous value on failure keeps what's on screen truthful.
 */
function RoleCell({ member, orgId }: { member: TeamMember; orgId: string }) {
  const [value, setValue] = useState(member.role);
  const [, startTransition] = useTransition();

  // A successful change elsewhere (this row, or a fresh server render after
  // revalidatePath) updates `member.role` via props — keep the local value
  // in sync with it rather than letting them drift apart.
  useEffect(() => setValue(member.role), [member.role]);

  return (
    <Select
      value={value}
      onValueChange={(role) => {
        const previous = value;
        setValue(role);
        startTransition(async () => {
          const res = await changeRoleAction(member.user_id, orgId, role);
          if (res.ok) {
            toast.success("Role updated");
          } else {
            setValue(previous);
            toast.error(res.error ?? "Couldn't update that role.");
          }
        });
      }}
    >
      <SelectTrigger
        aria-label={`Change role for ${member.full_name ?? member.email}`}
        className="h-8 w-[130px] rounded-lg"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASSIGNABLE_ROLES.map((r) => (
          <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TeamTable({ rows, total, page, per, sort, activeFilters, q, canManage, orgId }: {
  rows: TeamMember[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
  canManage: boolean; orgId: string;
}) {
  const columns = useMemo<ColumnDef<TeamMember, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Member",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8"><AvatarFallback className="text-[11px]">{initials(row.original)}</AvatarFallback></Avatar>
          <div>
            <div className="font-semibold">{row.original.full_name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{row.original.email ?? "—"}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const member = row.original;
        return canManage
          ? <RoleCell member={member} orgId={orgId} />
          : <span>{ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] ?? member.role}</span>;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.status === "invited"
          ? <Badge variant="secondary">Invited</Badge>
          : <Badge variant="outline">Active</Badge>,
    },
  ], [canManage, orgId]);

  return (
    <DataTable
      columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
      filterDefs={[ROLE_FILTER]} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search name or email…"
      emptyState={{ title: "No team members", description: "Invite an organizer to help run your events." }}
    />
  );
}
