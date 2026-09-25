import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fetchOrganizers } from "@/lib/organizers";
import { SiteHeader } from "@/components/SiteHeader";
import { OrganizerDirectory } from "./OrganizerDirectory";
import "./trail-atlas.css";

export const metadata: Metadata = {
  title: "Organizers",
  description: "Explore race organizers across the Philippines and their upcoming events.",
};

export const dynamic = "force-dynamic";

export default async function OrganizersPage() {
  const db = await createClient();
  const organizers = await fetchOrganizers(db);
  return (
    <>
      <SiteHeader />
      <main className="trail-atlas">
        <OrganizerDirectory organizers={organizers} />
      </main>
    </>
  );
}
