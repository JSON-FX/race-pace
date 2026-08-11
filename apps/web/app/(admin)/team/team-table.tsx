"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PhotoAvatar } from "@/components/PhotoAvatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DataTable, type FilterDef } from "@/components/data-table";
import { changeRoleAction, removeMemberAction } from "@/lib/actions/team";
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
        {(() => {
          const roles = [...ASSIGNABLE_ROLES];
          // Include the member's current role even if it's no longer assignable (e.g.,
          // old roles being phased out like "claiming"). This keeps the picker from
          // rendering blank for members already holding that role.
          if (!roles.includes(member.role as any)) {
            roles.push(member.role as any);
          }
          return roles.map((r) => (
            <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
          ));
        })()}
      </SelectContent>
    </Select>
  );
}

/**
 * Revocation, not just role management, is a permissions-critical
 * capability — without this, an org admin has no way to cut off a departed
 * staff member's access at all. The edge function independently refuses to
 * remove an org's last admin (409, same `wouldLeaveNoAdmin` guard as
 * changeRoleAction), so the error path here is real and must be surfaced,
 * not swallowed — the dialog stays open with the message until the admin
 * cancels or the removal actually succeeds.
 */
function RemoveMemberCell({ member, orgId }: { member: TeamMember; orgId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = member.full_name ?? member.email ?? "this member";

  async function confirmRemove() {
    setBusy(true);
    setError(null);
    const res = await removeMemberAction(member.user_id, orgId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't remove the member.");
      return;
    }
    toast.success("Member removed");
    setOpen(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost" size="icon-sm" aria-label={`Remove ${name}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They&apos;ll immediately lose access to this organization&apos;s admin console. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={confirmRemove}>
            {busy ? "Removing…" : "Remove member"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TeamTable({ rows, total, page, per, sort, activeFilters, q, orgId }: {
  rows: TeamMember[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
  orgId: string;
}) {
  // No `canManage` prop: the org-members edge function's "list" action
  // itself 403s a non-org-admin before it ever reaches the members-list
  // branch (see index.ts's caller-is-admin check, which runs before action
  // dispatch) — so TeamTable is only ever rendered for a caller who has
  // already been let past TeamPage's `roles.isOrgAdmin` gate. There is no
  // real "editor sees a read-only Team page" mode the server can serve
  // today, so there's no read-only rendering branch to keep here either.
  const columns = useMemo<ColumnDef<TeamMember, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Member",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <PhotoAvatar url={row.original.avatar_url} className="size-8" fallbackClassName="text-[11px]" fallback={initials(row.original)} />
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
      cell: ({ row }) => <RoleCell member={row.original} orgId={orgId} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RemoveMemberCell member={row.original} orgId={orgId} />
        </div>
      ),
    },
  ], [orgId]);

  return (
    <DataTable
      columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
      filterDefs={[ROLE_FILTER]} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search name or email…"
      emptyState={{ title: "No team members", description: "Invite an organizer to help run your events." }}
    />
  );
}
