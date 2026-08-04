import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { useMyRoles } from "../lib/roles";
import { useOrgMembers, setMemberRole, removeMember, ASSIGNABLE_ROLES, ROLE_LABELS, type OrgMember } from "../lib/team";
import { InviteMemberForm } from "../components/InviteMemberForm";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function Team() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const qc = useQueryClient();
  const members = useOrgMembers(orgId);
  const [pendingRemove, setPendingRemove] = useState<OrgMember | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function refresh() { qc.invalidateQueries({ queryKey: ["org-members", orgId] }); }

  async function changeRole(m: OrgMember, role: string) {
    if (role === m.role || !orgId) return;
    setRowError(null);
    const res = await setMemberRole(orgId, m.user_id, role);
    if (res.ok) { refresh(); toast.success("Role updated"); } else setRowError(res.error ?? "Couldn't change the role.");
  }

  async function confirmRemove() {
    if (!pendingRemove || !orgId) return;
    setRowError(null);
    const res = await removeMember(orgId, pendingRemove.user_id);
    if (res.ok) { setPendingRemove(null); refresh(); toast.success("Member removed"); }
    else setRowError(res.error ?? "Couldn't remove the member.");
  }

  const columns = useMemo<ColumnDef<OrgMember, unknown>[]>(() => [
    {
      id: "member",
      header: "Member",
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div>
            <div className="text-sm font-semibold">{m.full_name || m.email || m.user_id}</div>
            <div className="text-xs text-muted-foreground">{m.email}</div>
          </div>
        );
      },
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => {
        const m = row.original;
        return (
          <Select value={m.role} onValueChange={(role) => changeRole(m, role)}>
            <SelectTrigger aria-label={`Role for ${m.email ?? m.user_id}`} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div className="text-right">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              aria-label={`Remove ${m.email ?? m.user_id}`}
              onClick={() => { setRowError(null); setPendingRemove(m); }}
            >
              Remove
            </Button>
          </div>
        );
      },
    },
  ], [orgId]);

  if (roles.data && !roles.data.isOrgAdmin) {
    return <div className="p-2 text-muted-foreground">Team management is available to organization admins only.</div>;
  }

  return (
    <div className="max-w-[760px] px-4 pb-10 pt-6 md:px-[30px]">
      <h1 className="mb-1 text-[22px] font-bold">Team</h1>
      <p className="mb-5 text-sm text-muted-foreground">Invite staff and assign their role. Roles decide what they can do across the console and the mobile app.</p>

      {orgId ? <InviteMemberForm orgId={orgId} onInvited={refresh} /> : null}

      <div className="mt-6">
        <DataTable
          columns={columns}
          data={members.data ?? []}
          isLoading={members.isLoading}
          messages={{ loading: "Loading…", empty: "No team members yet.", error: "Couldn't load team members." }}
        />
      </div>

      {rowError && !pendingRemove ? <div role="alert" className="mt-2.5 text-[13px] text-destructive">{rowError}</div> : null}

      <AlertDialog open={!!pendingRemove} onOpenChange={(o) => { if (!o) { setPendingRemove(null); setRowError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this member?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove?.email} loses access to this organization. Their account isn't deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {rowError ? <div role="alert" className="text-[13px] text-destructive">{rowError}</div> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={(e) => { e.preventDefault(); void confirmRemove(); }}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
