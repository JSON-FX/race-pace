import { Card } from "@/components/ui/card";
import { ChevronRight, CalendarDays, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { RacesList } from "./RacesList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Races" };

export default async function RacesPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fraces");
  const { data: reservations } = await db.from("event_reservations")
    .select("id,status,registration_deadline_at,events(id,name,slug,status)")
    .eq("user_id", user.id).order("created_at", { ascending: false });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-14">
        <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[3px] text-primary">Your account</p>
        <h1 className="mt-2 font-display text-[clamp(1.9rem,5vw,2.6rem)] font-black leading-[1.05] tracking-[-1.2px] text-foreground">
          My Races
        </h1>

        {!!reservations?.length ? <section className="mt-8" aria-labelledby="reservations-heading">
          <h2 id="reservations-heading" className="font-display text-xl font-extrabold">Early reservations</h2>
          <p className="mt-1 text-sm text-muted-foreground">A reservation holds one event place. Registration payment is separate.</p>
          <div className="mt-4 grid gap-3">
            {reservations.map((reservation) => {
              const event = reservation.events as unknown as { name: string; status: string } | null;
              return <Card asChild key={reservation.id}
                className="group grid min-h-[112px] grid-cols-[48px_minmax(0,1fr)_20px] items-center gap-x-4 gap-y-2 p-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[48px_minmax(0,1fr)_auto_20px]">
                <Link href={`/reservations/${reservation.id}`}>
                  <span className="row-span-2 flex size-12 items-center justify-center rounded-xl bg-secondary text-secondary-foreground sm:row-span-1">
                    <Ticket className="size-6" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold leading-6">{event?.name ?? "Event reservation"}</span>
                    <span className="mt-2 flex items-start gap-2 text-sm leading-5 text-muted-foreground">
                      <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>Entry payment due {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" }).format(new Date(reservation.registration_deadline_at))} PHT</span>
                    </span>
                  </span>
                  <Badge variant="secondary" className="col-start-2 row-start-2 w-fit px-3 py-1 capitalize sm:col-start-3 sm:row-start-1">{reservation.status.replaceAll("_", " ")}</Badge>
                  <ChevronRight className="col-start-3 row-span-2 row-start-1 size-5 text-muted-foreground sm:col-start-4 sm:row-span-1" aria-hidden />
                </Link>
              </Card>;
            })}
          </div>
        </section> : null}
        <div className="mt-8">
          <RacesList />
        </div>
      </main>
    </>
  );
}
