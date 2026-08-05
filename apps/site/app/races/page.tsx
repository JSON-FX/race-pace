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
      <main className="mx-auto w-full max-w-3xl px-6 py-14">
        <p className="text-[12px] font-semibold uppercase tracking-[1.5px] text-primary">Your account</p>
        <h1 className="mt-2 font-display text-[40px] font-extrabold leading-[1.05] tracking-[-0.8px] text-foreground">
          My Races
        </h1>
        <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-muted-foreground">
          Every race you&apos;ve entered, from pending payment to race day.
        </p>

        <div className="mt-10">
          <RacesList />
        </div>
      </main>
    </>
  );
}
