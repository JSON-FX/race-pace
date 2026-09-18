import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { GroupOrder } from "./GroupOrder";

export const dynamic = "force-dynamic";

export default async function GroupOrderPage({ params, searchParams }: {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<{ status?: string }>;
}) {
  if (process.env.GROUP_CHECKOUT_ENABLED !== "true") notFound();
  const { orderId } = await params;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/group/order/${orderId}`)}`);
  const { data: order, error } = await db.from("booking_orders")
    .select("id,booked_by_user_id,status,entry_total_cents,expires_at,event_id,category_id,org_id")
    .eq("id", orderId).eq("booked_by_user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!order) notFound();
  const [event, category, organization] = await Promise.all([
    db.from("events").select("name").eq("id", order.event_id).single(),
    db.from("categories").select("label").eq("id", order.category_id).single(),
    db.from("organizations").select("fee_mode").eq("id", order.org_id).single(),
  ]);
  if (event.error || category.error || organization.error) throw new Error("Group payment terms are unavailable");
  return <><SiteHeader /><main><GroupOrder orderId={order.id} initialStatus={order.status} entryTotal={order.entry_total_cents ?? 0}
    eventName={event.data.name}
    categoryLabel={category.data.label}
    feeMode={organization.data.fee_mode === "pass_on" ? "pass_on" : "absorb"}
    expiresAt={order.expires_at} returnStatus={(await searchParams)?.status} /></main></>;
}
