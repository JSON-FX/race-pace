import { notFound } from "next/navigation";
import { Shield, Users } from "lucide-react";
import { hasCapability } from "@/lib/capabilities";
import { getMyRoles } from "@/lib/queries/roles";
import { getPlatformUsers } from "@/lib/queries/platform-users";
import { UsersDirectory } from "./users-directory";

export default async function UsersPage() {
  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) notFound();

  const users = await getPlatformUsers();

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-[18px] flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-forest px-4 py-[13px] text-white">
        <Shield className="size-[17px] shrink-0" strokeWidth={2} aria-hidden />
        <b className="text-[13.5px] font-bold">Platform scope</b>
        <span className="text-[12px] font-semibold text-white/60">All registered accounts · super admin</span>
        <span className="ms-auto rounded-pill bg-white/15 px-2.5 py-[3px] text-[11px] font-bold tabular-nums">
          {users.length} user{users.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mb-5 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <Users className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Registered users</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Account identity, event activity, Race Passports, and recent payments.
          </p>
        </div>
      </div>

      <UsersDirectory initialUsers={users} />
    </div>
  );
}
