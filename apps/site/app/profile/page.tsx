import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
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
      <main className="mx-auto w-full max-w-md px-6 py-14">
        <p className="text-[12px] font-semibold uppercase tracking-[1.5px] text-primary">Your account</p>
        <h1 className="mt-2 font-display text-[40px] font-extrabold leading-[1.05] tracking-[-0.8px] text-foreground">
          Race Passport
        </h1>

        <div className="mt-8">
          <ProfileForm userId={user.id} />
        </div>
      </main>
    </>
  );
}
