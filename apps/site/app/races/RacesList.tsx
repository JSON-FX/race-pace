"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPeso } from "@race-pace/shared";
import { useMyRegistrations, cancelRegistration, type RegistrationRow } from "@/lib/registration";
import { StatusBadge } from "@/components/StatusBadge";
import { TopoPattern } from "@/components/TopoPattern";
import { Button } from "@/components/ui/button";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Race day already behind us. Date-only compare in UTC, matching lib/format's
 *  handling of Postgres `date` columns — a local-time compare would flip an
 *  entry to "finished" during race morning under a positive offset. */
function isPast(eventDate: string | null): boolean {
  if (!eventDate) return false;
  return eventDate < new Date().toISOString().slice(0, 10);
}

function Thumb({ reg, past }: { reg: RegistrationRow; past: boolean }) {
  return (
    <div
      className={cn(
        "relative size-[84px] shrink-0 overflow-hidden rounded-lg border border-divider bg-muted sm:h-[88px] sm:w-[118px]",
        // Finished entries desaturate, so upcoming and past separate at a
        // glance without spending a second badge on it.
        past && "opacity-75 grayscale",
      )}
    >
      {reg.eventHeroUrl ? (
        <Image src={reg.eventHeroUrl} alt="" fill sizes="118px" className="object-cover" />
      ) : (
        <TopoPattern className="h-full w-full" />
      )}
    </div>
  );
}

export function RacesList() {
  const { data, isLoading } = useMyRegistrations();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "finished">("upcoming");

  const { upcoming, finished } = useMemo(() => {
    const rows = data ?? [];
    return {
      upcoming: rows.filter((r) => !isPast(r.eventDate)),
      finished: rows.filter((r) => isPast(r.eventDate)),
    };
  }, [data]);

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

  const rows = tab === "upcoming" ? upcoming : finished;

  const TABS = [
    { key: "upcoming" as const, label: "Upcoming", count: upcoming.length },
    { key: "finished" as const, label: "Finished", count: finished.length },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Race entries" className="flex gap-6 border-b border-divider">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative -mb-px pb-3 text-[13.5px] font-semibold transition-colors",
              tab === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label} · {t.count}
            {tab === t.key ? (
              <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-pill bg-primary" />
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-destructive/30 bg-destructive-tint px-4 py-3 text-[14px] text-destructive"
        >
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-16 text-center text-[15px] text-muted-foreground">
          {tab === "upcoming" ? "Nothing coming up." : "No finished races yet."}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {rows.map((r) => {
            const past = isPast(r.eventDate);
            return (
              <article
                key={r.id}
                className="flex gap-4 rounded-xl border border-border bg-card p-4 sm:items-center sm:p-4"
              >
                <Thumb reg={r} past={past} />

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0">
                      <h2 className="font-display text-[16px] font-extrabold leading-tight tracking-[-0.4px] text-foreground sm:text-[17.5px]">
                        {r.eventName}
                      </h2>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {[
                          r.categoryLabel,
                          r.eventDate ? longDate(r.eventDate) : null,
                          formatPeso(r.total_amount),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {/* The entry reference a runner quotes at check-in.
                          Derived exactly as TicketPanel derives it — same
                          slice of the same id — so the number here and the
                          number on the ticket can never disagree. There is no
                          bib NUMBER in the system: the ticket's "Bib" field is
                          the runner's bib name, so don't label this one that. */}
                      <p className="font-mono-race mt-1.5 text-[10.5px] uppercase tracking-[1.1px] text-muted-foreground">
                        {[
                          r.status === "paid"
                            ? `Ref ${r.id.slice(0, 8).toUpperCase()}`
                            : r.status === "pending"
                              ? "Ref issued on payment"
                              : null,
                          r.orgName,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>

                  <div className="mt-3.5 flex flex-wrap gap-2">
                    {r.status === "paid" ? (
                      <Button asChild className="h-auto rounded-pill px-5 py-2.5 text-[13px] font-semibold">
                        <Link href={`/ticket/${r.id}`}>View ticket</Link>
                      </Button>
                    ) : null}
                    {r.status === "pending" ? (
                      <>
                        <Button asChild className="h-auto rounded-pill px-5 py-2.5 text-[13px] font-semibold">
                          <Link href={`/pay/${r.id}`}>Complete payment</Link>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyId === r.id}
                          onClick={() => discard(r.id)}
                          className="h-auto rounded-pill px-5 py-2.5 text-[13px] font-semibold text-destructive hover:text-destructive"
                        >
                          {busyId === r.id ? "Discarding…" : "Discard"}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      asChild
                      variant="outline"
                      className="h-auto rounded-pill px-5 py-2.5 text-[13px] font-semibold"
                    >
                      <Link href={`/events/${r.event_id}`}>Race details</Link>
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
