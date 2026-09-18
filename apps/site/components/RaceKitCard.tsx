"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { kitEditLocked, daysUntil } from "@/lib/kit";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

/** Sits directly under the QR on the ticket page: the code the runner presents at pickup
 *  and the kit they are collecting belong together. The kit-release spec adds collection
 *  status to this same card. */
export function RaceKitCard({
  registrationId,
  shirtSize,
  kitEditClosesAt,
  onChange,
}: {
  registrationId?: string;
  shirtSize: string | null;
  kitEditClosesAt: string | null;
  onChange: () => void;
}) {
  const [collection, setCollection] = useState<{ released_at: string; kit: { shirt_size?: string | null } } | null>(null);
  const [collectionState, setCollectionState] = useState<"loading" | "ready" | "error">(registrationId ? "loading" : "ready");
  useEffect(() => {
    if (!registrationId) return;
    let live = true;
    const load = async () => {
      const { data, error } = await createClient().from("kit_releases").select("released_at,kit").eq("registration_id", registrationId).is("reversed_at", null).maybeSingle();
      if (!live) return;
      setCollection(data); setCollectionState(error ? "error" : "ready");
    };
    void load(); window.addEventListener("focus", load);
    return () => { live = false; window.removeEventListener("focus", load); };
  }, [registrationId]);
  const locked = !!collection || collectionState !== "ready" || kitEditLocked(kitEditClosesAt);
  const daysLeft = kitEditClosesAt && !locked ? daysUntil(kitEditClosesAt) : null;

  return (
    <section className="no-print mt-6 rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">Race kit</h2>
        {locked ? (
          <span className="flex items-center gap-1 rounded-pill bg-amber-tint px-2.5 py-1 text-[12px] text-amber">
            <Lock size={12} aria-hidden="true" /> Locked
          </span>
        ) : daysLeft !== null ? (
          // info-tint/info, not the non-existent accent-tint/accent — see
          // globals.css's note on shadcn tokens for why an undeclared
          // `--color-*` produces a silently dropped, invisible utility.
          <span className="rounded-pill bg-info-tint px-2.5 py-1 text-[12px] text-info">
            {daysLeft} {daysLeft === 1 ? "day" : "days"} left
          </span>
        ) : null}
      </div>

      {collection ? <p className="mb-3 text-sm font-medium">Collected {fmt(collection.released_at)}</p>
        : collectionState === "error" ? <p role="alert" className="mb-3 text-sm">Collection status unavailable. Refresh before changing your kit.</p>
        : collectionState === "loading" ? <p className="mb-3 text-sm">Checking collection status…</p>
        : registrationId ? <p className="mb-3 text-sm">Not collected yet. Bring your ticket when collecting your complete kit.</p> : null}
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Shirt size</p>
      <div className="flex items-baseline justify-between">
        <span className="text-[28px] font-semibold leading-none text-foreground">
          {collection?.kit.shirt_size ?? shirtSize ?? "—"}
        </span>
        {locked ? null : (
          <Button type="button" variant="outline" className="rounded-pill" onClick={onChange}>
            Change
          </Button>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {collection ? <>Your kit has been collected. Contact the organiser if this is incorrect.</> : collectionState !== "ready" ? <>Shirt changes are unavailable until collection status is confirmed.</> : locked ? (
          <>
            <Lock size={12} aria-hidden="true" />
            Sizes closed{kitEditClosesAt ? ` ${fmt(kitEditClosesAt)}` : ""}. Contact the organiser to change yours.
          </>
        ) : kitEditClosesAt ? (
          <>
            <Clock size={12} aria-hidden="true" />
            Sizes lock {fmt(kitEditClosesAt)}.
          </>
        ) : (
          <>You can change your size any time before race day.</>
        )}
      </p>
    </section>
  );
}
