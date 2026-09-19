import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountSectionNav } from "@/components/AccountSectionNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, ChevronRight, CircleCheck, Clock3, Ticket, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function statusClass(status: string) {
 return status === "paid" ? "border-paid/20 bg-paid-tint text-paid"
  : status === "pending" ? "border-amber/20 bg-amber-tint text-amber"
  : status === "refunded" || status === "cancelled" ? "border-destructive/20 bg-destructive-tint text-destructive"
  : "border-border bg-muted text-muted-foreground";
}

export default async function ManagedBookingsPage() {
 const db = await createClient();
 const { data: { user } } = await db.auth.getUser();
 if (!user) redirect("/sign-in?next=/bookings");
 const { data, error } = await db.from("registrations")
  .select("id,status,booking_order_id,custom_data,events(name),categories(label)").eq("booked_by_user_id",user.id)
  .or(`user_id.is.null,user_id.neq.${user.id}`).order("created_at",{ ascending:false });
 if (error) throw error;
 const bookings = data ?? [];
 const paidCount = bookings.filter((row) => row.status === "paid").length;
 const pendingCount = bookings.filter((row) => row.status === "pending").length;
 return <><SiteHeader /><main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
  <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[3px] text-primary">Your account</p>
  <h1 className="mt-2 font-display text-[clamp(1.9rem,5vw,2.6rem)] font-black leading-[1.05] tracking-[-1.2px] text-foreground">Bookings I manage</h1>
  <p className="mt-3 max-w-2xl text-muted-foreground">Registrations you made for other participants. Each paid runner has a separate ticket and Race Passport.</p>
  <div className="mt-6 overflow-x-auto pb-1"><AccountSectionNav current="bookings" bookingCount={bookings.length} /></div>

  <section className="mt-8 grid gap-4 sm:grid-cols-3" aria-label="Booking summary">
   <Card className="gap-2 p-5 py-5"><UsersRound className="size-5 text-primary" aria-hidden /><p className="font-eyebrow text-[10px] font-bold uppercase tracking-[1.8px] text-muted-foreground">Managed runners</p><p className="font-mono-race text-3xl font-bold">{bookings.length}</p></Card>
   <Card className="gap-2 p-5 py-5"><CircleCheck className="size-5 text-paid" aria-hidden /><p className="font-eyebrow text-[10px] font-bold uppercase tracking-[1.8px] text-muted-foreground">Paid</p><p className="font-mono-race text-3xl font-bold">{paidCount}</p></Card>
   <Card className="gap-2 p-5 py-5"><Clock3 className="size-5 text-amber" aria-hidden /><p className="font-eyebrow text-[10px] font-bold uppercase tracking-[1.8px] text-muted-foreground">Awaiting payment</p><p className="font-mono-race text-3xl font-bold">{pendingCount}</p></Card>
  </section>

  {!bookings.length ? <Card className="mt-6 items-center px-6 py-14 text-center"><span className="flex size-14 items-center justify-center rounded-full bg-secondary text-secondary-foreground"><Ticket aria-hidden /></span><h2 className="font-display text-xl font-bold">No assisted bookings yet</h2><p className="max-w-md text-sm text-muted-foreground">When you register another runner, their booking status and ticket actions will appear here.</p><Button asChild variant="outline"><Link href="/profile">Manage Race Passports</Link></Button></Card> : <ul className="mt-6 grid gap-4 md:grid-cols-2">{bookings.map(r => {
   const event = Array.isArray(r.events) ? r.events[0] : r.events;
   const category = Array.isArray(r.categories) ? r.categories[0] : r.categories;
   const participant = typeof r.custom_data?.full_name === "string" ? r.custom_data.full_name : "Participant";
   const action = r.status === "paid" ? { label: "View participant ticket", href: `/ticket/${r.id}` }
    : r.status === "pending" ? { label: "Continue payment", href: r.booking_order_id ? `/group/order/${r.booking_order_id}` : `/pay/${r.id}` }
    : null;
   return <li key={r.id}>
    <Card className="h-full gap-0 overflow-hidden py-0">
     <div className="flex items-start justify-between gap-4 border-b border-divider bg-muted/60 px-5 py-4">
      <div className="min-w-0"><p className="font-eyebrow text-[9px] font-bold uppercase tracking-[1.8px] text-primary">Participant</p><h2 className="mt-1 truncate font-display text-xl font-bold">{participant}</h2></div>
      <Badge variant="outline" className={cn("capitalize", statusClass(r.status))}>{r.status}</Badge>
     </div>
     <CardContent className="flex flex-1 flex-col px-5 py-5">
      <p className="font-semibold text-foreground">{event?.name ?? "Event"}</p>
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="size-4" aria-hidden />{category?.label ?? "Race category"}</p>
      {action ? <Button asChild className="mt-6 w-full justify-between" variant={r.status === "paid" ? "default" : "outline"}><Link href={action.href}>{action.label}<ChevronRight aria-hidden /></Link></Button> : null}
     </CardContent>
    </Card>
   </li>;
  })}</ul>}
 </main></>;
}
