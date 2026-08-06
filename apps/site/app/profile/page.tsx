import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fprofile");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md px-5 py-12 sm:px-6 sm:py-14">
        <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[3px] text-primary">Your account</p>
        <h1 className="mt-2 font-display text-[clamp(1.9rem,5vw,2.6rem)] font-black leading-[1.05] tracking-[-1.2px] text-foreground">
          Race Passport
        </h1>

        <div className="mt-8">
          <ProfileForm userId={user.id} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
