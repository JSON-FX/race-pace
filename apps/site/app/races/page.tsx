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
              return <Link key={reservation.id} href={`/reservations/${reservation.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-divider bg-card p-4 transition-colors hover:border-primary/40">
                <span><span className="block font-semibold">{event?.name ?? "Event reservation"}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">Entry payment due {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" }).format(new Date(reservation.registration_deadline_at))} PHT</span>
                </span>
                <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold capitalize text-primary">{reservation.status.replaceAll("_", " ")}</span>
              </Link>;
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
