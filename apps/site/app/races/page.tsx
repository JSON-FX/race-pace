import { redirect } from "next/navigation";
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

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-14">
        <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[3px] text-primary">Your account</p>
        <h1 className="mt-2 font-display text-[clamp(1.9rem,5vw,2.6rem)] font-black leading-[1.05] tracking-[-1.2px] text-foreground">
          My Races
        </h1>

        <div className="mt-8">
          <RacesList />
        </div>
      </main>
    </>
  );
}
