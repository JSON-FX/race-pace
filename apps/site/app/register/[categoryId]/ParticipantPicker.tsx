import { ArrowLeft, ChevronRight, ClipboardList, Plus, UserRound, UsersRound } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import Link from "next/link";
import type { CategoryRow, EventRow } from "@/lib/events";

export type ParticipantSummary = {
  id: string;
  claimed_user_id: string | null;
  first_name: string | null;
  last_name: string | null;
};

function participantName(participant: ParticipantSummary): string {
  const name = [participant.first_name, participant.last_name].filter(Boolean).join(" ");
  return name || "Incomplete Race Passport";
}

export function ParticipantPicker({
  category,
  event,
  participants,
  userId,
  groupCheckoutEnabled,
  reservationId,
}: {
  category: CategoryRow;
  event: EventRow;
  participants: ParticipantSummary[];
  userId: string;
  groupCheckoutEnabled: boolean;
  reservationId?: string | null;
}) {
  const eligibleParticipants = participants.filter(
    (participant) => !participant.claimed_user_id || participant.claimed_user_id === userId,
  );

  return (
    <main className="bg-muted/45 px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
      <div className="mx-auto w-full max-w-4xl">
        <Link
          href={`/events/${category.event_id}`}
          className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-pill px-1 text-[14px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Back to event
        </Link>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_20px_65px_rgb(var(--forest)/.10)]">
          <header className="bg-forest px-5 py-8 text-white sm:px-8 sm:py-10">
            <p className="font-eyebrow text-[10.5px] font-bold uppercase tracking-[2.4px] text-white/70">
              Registration · {category.label}
            </p>
            <h1 className="mt-3 font-display text-[clamp(2rem,7vw,3.5rem)] font-black uppercase leading-[0.94] tracking-[-1px]">
              Who is joining?
            </h1>
            <p className="mt-4 max-w-[58ch] text-[15.5px] leading-6 text-white/74 sm:text-[16px]">
              Choose the Race Passport for this entry. Every participant receives a separate registration, payment and ticket.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 font-mono-race text-[11px] font-semibold uppercase tracking-[0.8px] text-white/80">
              <span className="rounded-pill border border-white/18 bg-white/8 px-3 py-2">{event.name}</span>
              <span className="rounded-pill border border-white/18 bg-white/8 px-3 py-2">{formatPeso(category.base_price)}</span>
            </div>
          </header>

          <div className="p-5 sm:p-8">
            {groupCheckoutEnabled && !reservationId ? (
              <Link
                href={`/register/${category.id}/group`}
                className="group flex min-h-16 items-center gap-4 rounded-xl bg-primary px-4 py-3.5 text-primary-foreground transition-colors hover:bg-primary-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-5"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15">
                  <UsersRound size={21} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">Register several participants</span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-primary-foreground/75">Reserve their slots in one payment.</span>
                </span>
                <ChevronRight size={19} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            ) : null}

            <div className={groupCheckoutEnabled && !reservationId ? "mt-7" : ""}>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-primary">Race Passports</p>
                  <h2 className="mt-1 text-[18px] font-bold tracking-[-0.2px] text-foreground">Choose a participant</h2>
                </div>
                <span className="font-mono-race text-[11px] text-muted-foreground">{eligibleParticipants.length} ready</span>
              </div>

              {eligibleParticipants.length > 0 ? (
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {eligibleParticipants.map((participant) => {
                    const isSelf = participant.claimed_user_id === userId;
                    const name = participantName(participant);
                    return (
                      <li key={participant.id}>
                        <Link
                          href={`/register/${category.id}?participant=${participant.id}${reservationId ? `&reservation_id=${reservationId}` : ""}`}
                          className={`group flex min-h-28 h-full items-center gap-4 rounded-xl border p-4 transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            isSelf
                              ? "border-primary/35 bg-secondary/70 hover:border-primary"
                              : "border-border bg-card hover:border-primary/60 hover:shadow-sm"
                          }`}
                        >
                          <span
                            className={`grid size-11 shrink-0 place-items-center rounded-full ${
                              isSelf ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <UserRound size={21} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-eyebrow block text-[9.5px] font-bold uppercase tracking-[1.5px] text-muted-foreground">
                              {isSelf ? "Your Race Passport" : "Managed Race Passport"}
                            </span>
                            <span className="mt-1 block text-[15px] font-bold leading-snug text-foreground">
                              {isSelf ? "Register myself" : name}
                            </span>
                            {isSelf ? <span className="mt-0.5 block text-[13px] text-muted-foreground">{name}</span> : null}
                          </span>
                          <ChevronRight size={19} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div role="status" className="mt-4 rounded-xl border border-dashed border-border bg-muted/45 px-5 py-7 text-center">
                  <UserRound size={24} className="mx-auto text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 text-[14px] font-semibold">No complete Race Passports are ready yet.</p>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Create or complete one before continuing.</p>
                </div>
              )}
            </div>

            <div className="mt-7 grid gap-3 border-t border-divider pt-6 sm:grid-cols-2">
              <Link
                href="/profile"
                className="group flex min-h-14 items-center gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:border-primary/60 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                  <Plus size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-[14px] font-semibold">Create or complete a Race Passport</span>
                <ChevronRight size={17} className="shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
              </Link>
              <Link
                href="/bookings"
                className="group flex min-h-14 items-center gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:border-primary/60 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                  <ClipboardList size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-[14px] font-semibold">Bookings I manage</span>
                <ChevronRight size={17} className="shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
