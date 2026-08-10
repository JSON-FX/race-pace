"use client";

import Link from "next/link";
import Image from "next/image";
import { Clock, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPeso } from "@race-pace/shared";
import { useMyRegistrations, cancelRegistration, type RegistrationRow } from "@/lib/registration";
import { holdExpired } from "@/lib/holdExpiry";
import { StatusBadge } from "@/components/StatusBadge";
import { TopoPattern } from "@/components/TopoPattern";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Race day already behind us. Date-only compare in UTC, matching lib/format's
 *  handling of Postgres `date` columns — a local-time compare would flip an
 *  entry to "finished" during race morning under a positive offset. */
function isPast(eventDate: string | null): boolean {
  if (!eventDate) return false;
  return eventDate < new Date().toISOString().slice(0, 10);
}

/** Coarse on purpose: a to-the-second countdown on a 24-hour hold reads as
 *  panic, and the sweep that actually reclaims the slot only runs every 15
 *  minutes, so second-level precision would be a lie anyway. Hour buckets
 *  cover the bulk of the window; once under an hour the entry can vanish
 *  inside a single sweep cycle, so it switches to minutes and to `urgent`,
 *  which callers use to swap the calm amber treatment for the destructive
 *  one — the last hour is a genuinely different situation, not just a
 *  smaller number.
 *
 *  Returns null both when there is no hold (paid, or no expiry) AND when the
 *  hold has already lapsed — delegates that second check to `holdExpired`
 *  rather than re-deriving it from `ms <= 0` locally, so this can never
 *  disagree with the CTA gating in `RacesList` below (or with the event
 *  page's `fetchMyEntry`) about which pending rows are actually still live.
 *  A pending row can still be in the list moments before the 15-minute sweep
 *  deletes it, and this list's own fetch does not re-apply the server's
 *  lazy-expiry check the way lib/entry.ts does for the event page. Showing
 *  "0m left to pay" for an entry the server already considers gone would be
 *  worse than showing nothing.
 *
 *  Computed from Date.now() at render time, not a ticking interval: this
 *  hook's data comes from react-query with default options, which refetches
 *  (and re-renders this component) on mount and on every window/tab focus —
 *  precisely the moments a runner is actually looking at the page. Between
 *  those moments the number can drift, but at hour/minute granularity that
 *  drift is invisible until it would cross a bucket anyway, and a setInterval
 *  re-rendering the whole list every minute for a number nobody is reading
 *  is cost without benefit. */
export function holdRemaining(
  status: string,
  expiresAt: string | null,
): { label: string; urgent: boolean } | null {
  if (!expiresAt || holdExpired(status, expiresAt)) return null;
  const ms = Date.parse(expiresAt) - Date.now();
  // Belt-and-braces beyond `holdExpired`, which only fires for `status ===
  // "pending"`: `expiresAt` is documented as meaningful only while pending, so
  // a paid row should never carry a future-dated one, but a stale one left
  // over from before capture must not compute as a bogus "1m left to pay".
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return { label: `${hours}h left to pay`, urgent: false };
  return { label: `${Math.max(1, Math.round(ms / 60_000))}m left to pay`, urgent: true };
}

function HoldBadge({ status, expiresAt }: { status: string; expiresAt: string | null }) {
  const hold = holdRemaining(status, expiresAt);
  if (!hold) return null;
  const Icon = hold.urgent ? TriangleAlert : Clock;
  return (
    <span
      className={cn(
        "font-eyebrow inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[1.5px]",
        hold.urgent ? "border-destructive bg-destructive-tint text-destructive" : "border-amber bg-amber-tint text-amber",
      )}
    >
      <Icon size={11} aria-hidden="true" />
      {hold.label}
    </span>
  );
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
  const [tab, setTab] = useState<"upcoming" | "finished">("upcoming");
  // Holds the registration id awaiting confirmation, not the deletion itself —
  // cancelRegistration hard-DELETEs the row (see lib/registration.ts), so a
  // bare button click here would be one mis-tap away from destroying a real
  // entry. The dialog is the only path to `discard`.
  const [confirmTarget, setConfirmTarget] = useState<RegistrationRow | null>(null);
  // Lives on the dialog, not a page-top banner: a failed discard has to be
  // seen where the runner is actually looking at the moment it fails, which
  // is inside the dialog they just clicked "Yes, discard entry" in — closing
  // the dialog on failure the same as on success would be indistinguishable
  // from a success that silently didn't happen.
  const [dialogError, setDialogError] = useState<string | null>(null);

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

  // Returns whether the delete actually landed. RLS blocks deleting anything
  // that is not the owner's own still-pending row (e.g. it stopped being
  // cancellable between render and click — paid in another tab, or the sweep
  // beat the runner to it) — a zero-row delete throws in cancelRegistration.
  // The caller decides what "false" means for the UI; this function only
  // reports the outcome, it does not silently swallow it.
  async function discard(id: string): Promise<boolean> {
    setBusyId(id);
    try {
      await cancelRegistration(id);
      await queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      return true;
    } catch {
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function openConfirm(r: RegistrationRow) {
    setDialogError(null);
    setConfirmTarget(r);
  }

  function closeConfirm() {
    setConfirmTarget(null);
    setDialogError(null);
  }

  async function confirmDiscard() {
    if (!confirmTarget) return;
    setDialogError(null);
    const ok = await discard(confirmTarget.id);
    if (ok) {
      closeConfirm();
    } else {
      // Stay open — closing here would read as a success that never
      // happened. The runner is looking at this dialog right now; that is
      // where the failure has to surface, not a banner at the top of a page
      // they may already have scrolled past.
      setDialogError(
        "This entry can no longer be discarded — it may have just been paid, or already removed. Refresh and try again.",
      );
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

      {rows.length === 0 ? (
        <p className="py-16 text-center text-[15px] text-muted-foreground">
          {tab === "upcoming" ? "Nothing coming up." : "No finished races yet."}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {rows.map((r) => {
            const past = isPast(r.eventDate);
            // A pending row whose hold ran out is still literally `status:
            // 'pending'` until the 15-minute sweep flips it — the CTA area
            // has to derive the real verdict from `expires_at` itself
            // (`holdExpired`, shared with the event page's `fetchMyEntry`),
            // or a runner can be offered a "Complete payment" link the
            // server will refuse the moment they click it.
            const lapsed = holdExpired(r.status, r.expiresAt);
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
                    {/* Status and hold stack rather than sit side by side: both
                        are facts about the same clock (paid has no hold, so
                        only pending ever grows a second line), and stacking
                        keeps the row from fighting the CTAs below for width
                        on narrow screens. */}
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusBadge status={r.status} />
                      {r.status === "pending" ? <HoldBadge status={r.status} expiresAt={r.expiresAt} /> : null}
                    </div>
                  </div>

                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {r.status === "paid" ? (
                      <Button asChild className="h-auto rounded-pill px-5 py-2.5 text-[13px] font-semibold">
                        <Link href={`/ticket/${r.id}`}>View ticket</Link>
                      </Button>
                    ) : null}
                    {r.status === "pending" ? (
                      <>
                        {lapsed ? (
                          // No "Complete payment" here on purpose — the hold
                          // is gone, and the server will refuse the payment
                          // the moment this link is clicked. Say so, and
                          // point at the actual next step (re-entering)
                          // instead of leaving a dead-end button live.
                          <p className="text-[13px] leading-relaxed text-muted-foreground">
                            Payment window closed — this hold ran out and the slot is back in the
                            pool.{" "}
                            <Link
                              href={`/events/${r.event_id}`}
                              className="font-semibold text-foreground underline underline-offset-2"
                            >
                              Enter again
                            </Link>
                            .
                          </p>
                        ) : (
                          <Button asChild className="h-auto rounded-pill px-5 py-2.5 text-[13px] font-semibold">
                            <Link href={`/pay/${r.id}`}>Complete payment</Link>
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyId === r.id}
                          onClick={() => openConfirm(r)}
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

      <Dialog open={!!confirmTarget} onOpenChange={(open) => !open && closeConfirm()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard this entry?</DialogTitle>
            <DialogDescription>
              {confirmTarget ? (
                <>
                  You&apos;ll lose your spot for{" "}
                  <span className="font-semibold text-foreground">{confirmTarget.eventName}</span>
                  {confirmTarget.categoryLabel ? ` (${confirmTarget.categoryLabel})` : ""}. This can&apos;t be
                  undone — the slot goes back into the pool immediately, and if you change your mind you&apos;ll
                  need to register again with no guarantee of space.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {dialogError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive-tint px-3.5 py-2.5 text-[13.5px] text-destructive"
            >
              {dialogError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeConfirm}>
              Keep entry
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!!confirmTarget && busyId === confirmTarget.id}
              onClick={confirmDiscard}
            >
              {confirmTarget && busyId === confirmTarget.id ? "Discarding…" : "Yes, discard entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
