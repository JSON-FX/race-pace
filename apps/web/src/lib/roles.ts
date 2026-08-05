import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type MyRoles = {
  role: string | null;
  orgId: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isOrgAdmin: boolean;
  isMarshal: boolean;
  /** Mirrors canCheckIn() in supabase/functions/_shared/authz.ts. */
  canCheckIn: boolean;
};

export function useMyRoles() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery<MyRoles>({
    queryKey: ["my-roles", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role, org_id");
      if (error) throw error;
      const rows = data ?? [];
      const isSuperAdmin = rows.some((r) => r.role === "super_admin");
      const adminRow = rows.find((r) => r.role === "admin" || r.role === "editor");
      const isAdmin = isSuperAdmin || !!adminRow;
      const isMarshal = rows.some((r) => r.role === "marshal");
      return {
        role: isSuperAdmin ? "super_admin" : adminRow?.role ?? rows[0]?.role ?? null,
        orgId: adminRow?.org_id ?? null,
        isSuperAdmin,
        isAdmin,
        isOrgAdmin: isSuperAdmin || rows.some((r) => r.role === "admin"),
        isMarshal,
        canCheckIn: isAdmin || isMarshal,
      };
    },
  });
}
