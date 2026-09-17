import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
export const dynamic = "force-dynamic";
export default async function ManagedBookingsPage() {
 const db = await createClient();
 const { data: { user } } = await db.auth.getUser();
 if (!user) redirect("/sign-in?next=/bookings");
 const { data, error } = await db.from("registrations")
  .select("id,status,custom_data,events(name),categories(label)").eq("booked_by_user_id",user.id)
  .or(`user_id.is.null,user_id.neq.${user.id}`).order("created_at",{ ascending:false });
 if (error) throw error;
 return <><SiteHeader /><main className="mx-auto max-w-2xl px-6 py-12">
  <h1 className="text-2xl font-bold">Bookings I manage</h1>
  <p className="mt-3">Registrations you made for other participants. Each paid participant has their own race pass.</p>
  {!data?.length ? <p className="mt-6">No assisted bookings yet.</p> : <ul className="mt-6 space-y-4">{data.map(r => {
   const event = Array.isArray(r.events) ? r.events[0] : r.events;
   const participant = typeof r.custom_data?.full_name === "string" ? r.custom_data.full_name : "Participant";
   return <li key={r.id} className="rounded-xl border p-4">
    <h2 className="font-semibold">{participant}</h2><p>{event?.name ?? "Event"}</p><p className="mt-1 text-sm capitalize">{r.status}</p>
    {r.status === "pending" || r.status === "paid" ? <Link className="mt-3 inline-block underline" href={r.status === "paid" ? `/ticket/${r.id}` : `/pay/${r.id}`}>{r.status === "paid" ? "View or print participant ticket" : "Continue payment"}</Link> : null}
   </li>;
  })}</ul>}
  <Link className="mt-6 inline-block underline" href="/profile">Manage Race Passports</Link>
 </main></>;
}
