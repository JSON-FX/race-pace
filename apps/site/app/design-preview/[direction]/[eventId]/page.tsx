import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchEvent, fetchCategories, fetchAddons } from "@/lib/events";
import { DirectionDossier } from "@/components/preview/DirectionDossier";
import { DirectionKinetic } from "@/components/preview/DirectionKinetic";

// Same force-dynamic rule as the real catalog pages: a preview showing stale
// slot counts would misrepresent the design being evaluated.
export const dynamic = "force-dynamic";

const DIRECTIONS = { dossier: DirectionDossier, kinetic: DirectionKinetic } as const;
type DirectionKey = keyof typeof DIRECTIONS;

export default async function DesignPreviewPage({
  params,
}: {
  params: Promise<{ direction: string; eventId: string }>;
}) {
  const { direction, eventId } = await params;
  const Direction = DIRECTIONS[direction as DirectionKey];
  if (!Direction) notFound();

  const db = await createClient();
  const event = await fetchEvent(db, eventId);
  if (!event) notFound();
  // Independent reads — awaiting them in sequence would stack three round
  // trips before the first byte renders.
  const [categories, addons] = await Promise.all([fetchCategories(db, eventId), fetchAddons(db, eventId)]);

  return (
    <>
      <Direction event={event} categories={categories} addons={addons} />
      {/* Persistent way back to the comparison index — a preview you can get
          lost inside is a preview nobody finishes reviewing. */}
      <Link
        href="/design-preview"
        className="fixed bottom-4 left-4 z-50 rounded-pill bg-black/80 px-4 py-2.5 text-[13px] font-semibold text-white backdrop-blur-sm hover:bg-black"
      >
        ← All options
      </Link>
    </>
  );
}
