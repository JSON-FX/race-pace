import { Badge } from "@/components/ui/badge";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Users } from "lucide-react";
import { hasCapability } from "@/lib/capabilities";
import { getMyRoles } from "@/lib/queries/roles";
import { getPlatformUsers } from "@/lib/queries/platform-users";
import { UsersDirectory } from "./users-directory";

export default async function UsersPage() {
  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) notFound();

  const users = await getPlatformUsers();
  const managedPassports = new Set(users.flatMap(user => user.passports.filter(passport => passport.relationship === "managed").map(passport => passport.id))).size;

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-[18px] flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-forest px-4 py-[13px] text-white">
        <Shield className="size-[17px] shrink-0" strokeWidth={2} aria-hidden />
        <b className="text-[13.5px] font-bold">Platform scope</b>
        <span className="text-[12px] font-semibold text-white/60">All registered accounts · super admin</span>
        <Badge variant="secondary" className="ms-auto px-2.5 py-[3px] tabular-nums">
          {users.length} user{users.length === 1 ? "" : "s"}
        </Badge>
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

      <section className="mb-6 grid gap-4 sm:grid-cols-2" aria-label="Platform totals">
        <Card className="gap-0 py-0"><CardContent className="flex items-center justify-between gap-4 p-5">
          <span className="text-sm font-medium text-muted-foreground">Registered users</span><strong className="text-3xl font-semibold tabular-nums">{users.length.toLocaleString("en-PH")}</strong>
        </CardContent></Card>
        <Card className="gap-0 py-0"><CardContent className="flex items-center justify-between gap-4 p-5">
          <span className="text-sm font-medium text-muted-foreground">Managed Passports</span><strong className="text-3xl font-semibold tabular-nums">{managedPassports.toLocaleString("en-PH")}</strong>
        </CardContent></Card>
      </section>
      <UsersDirectory initialUsers={users} />
    </div>
  );
}
