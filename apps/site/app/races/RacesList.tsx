"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPeso } from "@race-pace/shared";
import { useMyRegistrations, cancelRegistration } from "@/lib/registration";
import { StatusBadge } from "@/components/StatusBadge";
import { TopoPattern } from "@/components/TopoPattern";
import { Button } from "@/components/ui/button";
import { longDate } from "@/lib/format";

export function RacesList() {
  const { data, isLoading } = useMyRegistrations();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <p className="py-20 text-center text-muted-foreground">Loading…</p>;

  if (!data?.length) {
    return (
      <div className="rounded-xl border border-dashed border-border py-20 text-center">
        <p className="text-[17px] text-muted-foreground">You haven&apos;t entered a race yet.</p>
        <Button asChild className="mt-6 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href="/events">Browse races</Link>
        </Button>
      </div>
    );
  }

  async function discard(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await cancelRegistration(id);
      await queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
    } catch {
      // RLS blocks deleting anything that is not the owner's own pending row —
      // a zero-row delete throws in cancelRegistration, so this catch is the
      // only place that failure can be told to the runner. Silence here would
      // read as a successful discard that never happened.
      setError("That registration can no longer be discarded. Refresh and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive-tint px-4 py-3 text-[14px] text-destructive">
          {error}
        </p>
      ) : null}

      {data.map((r) => (
        <article
          key={r.id}
          className="flex flex-col overflow-hidden rounded-xl border border-border bg-card sm:flex-row"
        >
          <div className="relative h-36 shrink-0 overflow-hidden bg-muted sm:h-auto sm:w-48">
            {r.eventHeroUrl ? (
              <Image src={r.eventHeroUrl} alt="" fill sizes="192px" className="object-cover" />
            ) : (
              <TopoPattern className="h-full w-full" />
            )}
          </div>

          <div className="flex flex-1 flex-col p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {r.orgName ? (
                  <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-primary">{r.orgName}</p>
                ) : null}
                <h2 className="mt-1 font-display text-[19px] font-extrabold tracking-[-0.3px] text-foreground">
                  {r.eventName}
                </h2>
                <p className="mt-1 text-[14px] text-muted-foreground">
                  {[r.categoryLabel, r.eventDate ? longDate(r.eventDate) : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </div>

            <p className="mt-4 text-[15px] font-semibold tabular-nums text-foreground">{formatPeso(r.total_amount)}</p>

            <div className="mt-auto flex flex-wrap gap-3 pt-5">
              {r.status === "paid" ? (
                <Button asChild className="h-auto rounded-pill px-6 py-3 text-[15px] font-semibold">
                  <Link href={`/ticket/${r.id}`}>View ticket</Link>
                </Button>
              ) : null}
              {r.status === "pending" ? (
                <>
                  <Button asChild className="h-auto rounded-pill px-6 py-3 text-[15px] font-semibold">
                    <Link href={`/pay/${r.id}`}>Complete payment</Link>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyId === r.id}
                    onClick={() => discard(r.id)}
                    className="h-auto rounded-pill px-6 py-3 text-[15px] font-semibold"
                  >
                    {busyId === r.id ? "Discarding…" : "Discard"}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
