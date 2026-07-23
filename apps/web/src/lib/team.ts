import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type OrgMember = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at?: string;
};

export const ASSIGNABLE_ROLES = ["admin", "editor", "marshal", "claiming"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export const ROLE_LABELS: Record<AssignableRole, string> = {
  admin: "Admin", editor: "Editor", marshal: "Marshal", claiming: "Race Kit",
};

function errorMessage(error: unknown): string {
  const status = (error as { context?: { status?: number } }).context?.status;
  return status === 403 ? "You don't have permission to manage this team."
    : status === 409 ? "An organization must keep at least one admin."
    : status === 502 ? "Couldn't send the invite — try again."
    : status === 400 ? "That role can't be assigned."
    : "Something went wrong. Please try again.";
}

export function useOrgMembers(orgId?: string) {
  return useQuery<OrgMember[]>({
    queryKey: ["org-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("org-members", { body: { action: "list", org_id: orgId } });
      if (error) throw new Error(errorMessage(error));
      return (data as { members?: OrgMember[] })?.members ?? [];
    },
  });
}

export async function inviteMember(orgId: string, email: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("org-members", { body: { action: "invite", org_id: orgId, email, role } });
  return error ? { ok: false, error: errorMessage(error) } : { ok: true };
}

export async function setMemberRole(orgId: string, userId: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("org-members", { body: { action: "setRole", org_id: orgId, user_id: userId, role } });
  return error ? { ok: false, error: errorMessage(error) } : { ok: true };
}

export async function removeMember(orgId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("org-members", { body: { action: "remove", org_id: orgId, user_id: userId } });
  return error ? { ok: false, error: errorMessage(error) } : { ok: true };
}
