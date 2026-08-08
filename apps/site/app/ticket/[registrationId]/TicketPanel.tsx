"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { useRegistration } from "@/lib/registration";
import { getProfile } from "@/lib/profile";
import { TicketCard } from "@/components/TicketCard";
import { RaceKitCard } from "@/components/RaceKitCard";
import { ShirtSizeSheet } from "@/components/ShirtSizeSheet";
import { Button } from "@/components/ui/button";

export function TicketPanel({ registrationId, userId }: { registrationId: string; userId: string }) {
  const reg = useRegistration(registrationId);
  const [profile, setProfile] = useState<{ full_name: string | null; bib_name: string | null } | null>(null);
  const [editingSize, setEditingSize] = useState(false);

  useEffect(() => {
    getProfile(userId).then((p) => p && setProfile(p));
  }, [userId]);

  const reference = registrationId.slice(0, 8).toUpperCase();

  if (reg.isLoading) return <p className="py-20 text-center text-muted-foreground">Loading…</p>;
  if (!reg.data) return <p className="py-20 text-center text-muted-foreground">We couldn&apos;t find that registration.</p>;

  if (!reg.data.ticket_token) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-20 text-center">
        <h1 className="text-[24px] font-semibold text-foreground">No ticket yet</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">Complete payment to get your race pass.</p>
        <Button asChild className="mt-8 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href={`/pay/${registrationId}`}>Complete payment</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-6 py-10">
      {reg.data.statusNote ? (
        <p className="no-print mb-6 rounded-xl border border-amber bg-amber-tint px-4 py-3 text-[14px] text-foreground">
          {reg.data.statusNote}
        </p>
      ) : null}

      <TicketCard
        token={reg.data.ticket_token}
        eventName={reg.data.eventName}
        categoryLabel={reg.data.categoryLabel}
        eventDate={reg.data.eventDate}
        reference={reference}
        runnerName={profile?.full_name ?? null}
        bibName={profile?.bib_name ?? null}
        distanceKm={reg.data.categoryDistance}
      />

      <RaceKitCard
        shirtSize={reg.data.shirtSize}
        kitEditClosesAt={reg.data.kitEditClosesAt}
        onChange={() => setEditingSize(true)}
      />

      {editingSize ? (
        <ShirtSizeSheet
          registrationId={registrationId}
          current={reg.data.shirtSize}
          onClose={() => setEditingSize(false)}
          onSaved={() => {
            setEditingSize(false);
            reg.refetch();
          }}
        />
      ) : null}

      <div className="no-print mt-6 flex flex-col gap-3">
        <Button
          type="button"
          onClick={() => window.print()}
          className="h-auto gap-2 rounded-pill py-4 text-[16px] font-semibold"
        >
          <Printer size={17} /> Save as PDF / Print
        </Button>
        <p className="text-center text-[13px] text-muted-foreground">
          We&apos;ve also emailed this ticket to you. Save it offline — trailheads rarely have signal.
        </p>
        <Button asChild variant="outline" className="h-auto rounded-pill py-4 text-[15px] font-semibold">
          <Link href="/races">Back to My Races</Link>
        </Button>
      </div>
    </div>
  );
}
