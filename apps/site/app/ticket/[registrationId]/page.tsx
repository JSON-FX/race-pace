import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { TicketPanel } from "./TicketPanel";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ registrationId: string }> }) {
  const { registrationId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/ticket/${registrationId}`)}`);

  return (
    <>
      <SiteHeader />
      <main>
        <TicketPanel registrationId={registrationId} userId={user.id} />
      </main>
    </>
  );
}
