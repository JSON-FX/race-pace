import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "../lib/supabase";
import { useMyRoles } from "../lib/roles";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard", "/events": "Events", "/registrations": "Registrations",
  "/payments": "Payments", "/check-in": "Race-day check-in", "/settings": "Settings",
  "/organizations": "Organizations", "/commission": "Commission", "/payouts": "Payout statements",
};

export function TopBar() {
  const { pathname } = useLocation();
  const roles = useMyRoles();
  const orgId = roles.data?.orgId;
  const org = useQuery({
    queryKey: ["org-name", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId).single();
      return data?.name ?? "";
    },
  });
  const title = pathname === "/events/new" ? "Create event"
    : /^\/events\/[^/]+\/edit$/.test(pathname) ? "Edit event"
    : TITLES[pathname] ?? "Dashboard";
  const orgLabel = roles.data?.isSuperAdmin ? "Platform · Super admin" : org.data ?? "";

  return (
    <header className="flex h-[66px] shrink-0 items-center gap-4 border-b border-border bg-card px-4 md:px-[30px]">
      <SidebarTrigger />
      <div className="text-lg font-bold tracking-tight">{title}</div>
      {orgLabel ? <Badge variant="secondary" className="ml-auto text-[13px] font-semibold">{orgLabel}</Badge> : null}
    </header>
  );
}
