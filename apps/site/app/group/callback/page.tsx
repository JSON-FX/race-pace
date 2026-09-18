import { redirect } from "next/navigation";

export default async function GroupCallbackPage({ searchParams }: {
  searchParams: Promise<{ order_id?: string; status?: string }>;
}) {
  const { order_id, status } = await searchParams;
  if (!order_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order_id)) redirect("/bookings");
  redirect(`/group/order/${order_id}${status ? `?status=${encodeURIComponent(status)}` : ""}`);
}
