import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { PayPanel } from "./PayPanel";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ registrationId: string }> }) {
  const { registrationId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/pay/${registrationId}`)}`);

  // An already-paid registration has nothing to pay — send them to the ticket.
  const { data: reg } = await db.from("registrations").select("status").eq("id", registrationId).maybeSingle();
  if (reg?.status === "paid") redirect(`/ticket/${registrationId}`);

  return (
    <>
      <SiteHeader />
      <main>
        <PayPanel registrationId={registrationId} />
      </main>
    </>
  );
}
