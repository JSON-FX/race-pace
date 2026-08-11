"use client";

import Image from "next/image";
import Link from "next/link";
import { Check, Clock, ArrowUpRight } from "lucide-react";
import { disciplineLayout, formatPeso, formatDateRange } from "@race-pace/shared";
import type { EventRow, CategoryRow, AddonRow } from "@/lib/events";
import type { MyEntry } from "@/lib/entry";
import { longDate } from "@/lib/format";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { Reveal, ParallaxLayer, CountUp, ScrollProgress } from "./motion-primitives";
import {
  RaceEssentials,
  RaceMorning,
  WhatsIncluded,
  AddonsSection,
  GalleryCarousel,
  CourseLocator,
} from "./sections";

/**
 * The public event page — "Expedition Dossier" (chosen 2026-08-06 from two
 * directions previewed at /design-preview, since removed).
 *
 * Premise: a race is a set of hard numbers a runner is deciding whether they
 * can survive. So the page is built like a technical document — oversized
 * Archivo Black headline, hairline rules, and every fact rendered in JetBrains
 * Mono at a size you can read across a room. Restraint everywhere except
 * scale.
 *
 * The discipline branch changes the *argument*, not just the palette:
 *  - profile (trail/ultra): vertical gain is the headline number. Dark forest
 *    canvas, the course reads as something to be survived.
 *  - route (road/fun-run): finish time and pace are the headline. Light,
 *    high-key, the course reads as something to be raced.
 */
export function EventPageBody({
  event,
  categories,
  addons = [],
  closed,
  myEntry = null,
}: {
  event: EventRow;
  categories: CategoryRow[];
  addons?: AddonRow[];
  /** Registration is cancelled/closed/completed. Derived by the caller from
   *  isRegistrationClosed() so the page and the server agree on one rule. */
  closed: boolean;
  /** The runner's existing entry for this event, on any distance. Null for a
   *  signed-out visitor or one who hasn't entered yet. */
  myEntry?: MyEntry | null;
}) {
  const layout = disciplineLayout(event.discipline);
  const trail = layout === "profile";
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const longest = categories.reduce<CategoryRow | null>(
    (a, c) => (c.distance_km != null && (!a || (a.distance_km ?? 0) < c.distance_km) ? c : a),
    null,
  );
  const slotsLeft = categories.reduce((n, c) => n + Math.max(0, c.slots_total - c.slots_taken), 0);
  const tone = { dark: trail };

  // The page-level CTAs (hero + closing band) have to agree with the row-level
  // ones: a runner with a live entry gets pointed straight at it, same as
  // DistanceRow does — and, same as DistanceRow, that takes priority over
  // `closed`. A completed/cancelled event can still owe a runner a look at
  // the entry they already hold; "See race details" would bury it.
  const topHref = myEntry ? (myEntry.status === "paid" ? "/races" : `/pay/${myEntry.id}`) : "#distances";
  const topLabel = myEntry
    ? myEntry.status === "paid"
      ? "View your entry"
      : "Finish payment"
    : closed
      ? "See race details"
      : "Choose your distance";

  return (
    <div className={trail ? "bg-[#06120C] text-white" : "bg-white text-[#0B1220]"}>
      <ScrollProgress />

      {/* ── Hero ─────────────────────────────────────────────────────────
          min-h-dvh not 100vh: on mobile browsers 100vh sits under the
          collapsing address bar and clips the CTA below the fold. */}
      <section className="relative isolate flex min-h-dvh flex-col justify-end overflow-hidden">
        <ParallaxLayer className="absolute inset-0 -z-10">
          {event.hero_image_url ? (
            <Image
              src={event.hero_image_url}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          ) : (
            <div className="h-full w-full bg-forest" />
          )}
        </ParallaxLayer>
        <div
          className={
            trail
              ? "absolute inset-0 -z-10 bg-gradient-to-b from-[#06120C]/70 via-[#06120C]/55 to-[#06120C]"
              : "absolute inset-0 -z-10 bg-gradient-to-b from-[#0B1220]/75 via-[#0B1220]/45 to-[#0B1220]/90"
          }
        />

        <div className="mx-auto w-full max-w-6xl px-5 pb-14 sm:px-8 sm:pb-20">
          <Reveal>
            <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[4px] text-primary sm:text-[12px]">
              {event.org_name ?? "Race Pace"} · {trail ? "Trail / Ultra" : "Road"}
            </p>
          </Reveal>

          <Reveal delay={0.06}>
            {/* clamp() carries the headline from 375px to 1440px without a
                single breakpoint — the type scales with the viewport rather
                than stepping between three fixed sizes. */}
            <h1 className="mt-3 font-display text-[clamp(2.6rem,9vw,7rem)] font-black uppercase leading-[0.86] tracking-[-2px] text-white">
              {event.name}
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <div className="font-mono-race mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] uppercase tracking-[1px] text-white/75 sm:text-[13.5px]">
              {date ? <span>{date}</span> : null}
              {event.city_name ? <span>{event.city_name}, {event.province_name}</span> : null}
              {event.venue ? <span>{event.venue}</span> : null}
            </div>
          </Reveal>

          {/* The dossier strip: the numbers that decide whether a runner
              enters. Count-ups fire once, on scroll. */}
          <Reveal delay={0.18}>
            <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/15 sm:grid-cols-4">
              <Stat
                label={trail ? "Vertical gain" : "Longest"}
                value={
                  trail && event.elevation_gain_m ? (
                    <><CountUp value={event.elevation_gain_m} /><Unit>m</Unit></>
                  ) : longest?.distance_km != null ? (
                    <><CountUp value={longest.distance_km} /><Unit>km</Unit></>
                  ) : (
                    <>—</>
                  )
                }
                dark={trail}
              />
              <Stat
                label="Distances"
                value={<CountUp value={categories.length} />}
                dark={trail}
              />
              <Stat
                label={trail ? "Cut-off" : "Flag off"}
                value={
                  trail && longest?.cutoff_hours ? (
                    <><CountUp value={longest.cutoff_hours} /><Unit>h</Unit></>
                  ) : event.flag_off ? (
                    <span className="text-[clamp(1.3rem,3vw,2rem)]">{event.flag_off}</span>
                  ) : (
                    <>—</>
                  )
                }
                dark={trail}
              />
              <Stat label="Slots left" value={<CountUp value={slotsLeft} />} dark={trail} />
            </dl>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-10">
              <RainbowButton asChild className="h-auto w-full rounded-pill px-8 py-4 text-[16px] font-semibold sm:w-auto">
                {myEntry ? (
                  <Link href={topHref}>{topLabel}</Link>
                ) : (
                  <a href={topHref}>{topLabel}</a>
                )}
              </RainbowButton>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Description ─────────────────────────────────────────────── */}
      {event.status_note ? (
        <section className={trail ? "border-t border-white/10" : "border-t border-black/10"}>
          <div className="mx-auto w-full max-w-6xl px-5 pt-14 sm:px-8">
            <Reveal>
              <p className="rounded-xl border border-amber bg-amber-tint px-5 py-4 text-[15.5px] leading-relaxed text-amber">
                {event.status_note}
              </p>
            </Reveal>
          </div>
        </section>
      ) : null}

      {event.description ? (
        <section className={trail ? "border-t border-white/10" : "border-t border-black/10"}>
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <Reveal>
              {/* max-w-[60ch]: measure control, not decoration — past ~75
                  characters the eye loses the line return. */}
              <p
                className={`max-w-[60ch] text-[clamp(1.05rem,2.2vw,1.5rem)] leading-[1.55] ${
                  trail ? "text-white/85" : "text-[#0B1220]/80"
                }`}
              >
                {event.description}
              </p>
            </Reveal>
          </div>
        </section>
      ) : null}

      {/* ── Distances ──────────────────────────────────────────────── */}
      <section
        id="distances"
        className={trail ? "border-t border-white/10 scroll-mt-16" : "border-t border-black/10 scroll-mt-16"}
      >
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="font-display text-[clamp(1.8rem,5vw,3.4rem)] font-black uppercase leading-[0.95] tracking-[-1px]">
              {trail ? "Pick your suffering" : "Pick your pace"}
            </h2>
          </Reveal>

          <ul className="mt-10">
            {categories.map((c, i) => (
              <DistanceRow key={c.id} category={c} index={i} trail={trail} closed={closed} myEntry={myEntry} />
            ))}
          </ul>
        </div>
      </section>

      {/* Order follows the questions a runner asks after "can I do this?":
          what exactly is the day → where is it → what do I get → what else can
          I add → what does it look like. Each section self-hides when empty. */}
      <RaceEssentials event={event} tone={tone} />
      <CourseLocator event={event} tone={tone} />
      <RaceMorning event={event} tone={tone} />
      <WhatsIncluded event={event} tone={tone} />
      <AddonsSection addons={addons} tone={tone} />
      <GalleryCarousel event={event} tone={tone} />

      {/* Closing CTA: by here the runner has read everything, and sending them
          back up to the hero to act would be the page's own fault. Same
          myEntry-first precedence as the hero: a runner who already owes a
          payment or wants their ticket should never be told to go pick a
          distance again, on the way out any more than on the way in. */}
      <section className={trail ? "border-t border-white/10" : "border-t border-black/10"}>
        <div className="mx-auto w-full max-w-6xl px-5 py-20 text-center sm:px-8 sm:py-28">
          <Reveal>
            <h2 className="font-display text-[clamp(1.9rem,5.5vw,3.6rem)] font-black uppercase leading-[0.95] tracking-[-1px]">
              {myEntry
                ? myEntry.status === "paid"
                  ? "You're in."
                  : "Almost there."
                : closed
                  ? "Registration is closed"
                  : trail
                    ? "Still reading? Enter."
                    : "See you at the start."}
            </h2>
          </Reveal>
          {myEntry || !closed ? (
            <Reveal delay={0.08}>
              <div className="mt-8 flex justify-center">
                <RainbowButton asChild className="h-auto rounded-pill px-9 py-4 text-[16.5px] font-semibold">
                  {myEntry ? (
                    <Link href={topHref}>{topLabel}</Link>
                  ) : (
                    <a href={topHref}>{topLabel}</a>
                  )}
                </RainbowButton>
              </div>
            </Reveal>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Unit({ children }: { children: React.ReactNode }) {
  return <span className="ml-0.5 text-[0.45em] font-semibold uppercase tracking-[1px] opacity-70">{children}</span>;
}

function Stat({ label, value, dark }: { label: string; value: React.ReactNode; dark: boolean }) {
  return (
    <div className={dark ? "bg-[#06120C] px-4 py-5 sm:px-5" : "bg-[#0B1220] px-4 py-5 sm:px-5"}>
      <dt className="font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-white/55">{label}</dt>
      <dd className="font-mono-race mt-1.5 text-[clamp(1.6rem,4vw,2.4rem)] font-bold leading-none text-white">
        {value}
      </dd>
    </div>
  );
}

function DistanceRow({
  category,
  index,
  trail,
  closed,
  myEntry,
}: {
  category: CategoryRow;
  index: number;
  trail: boolean;
  closed: boolean;
  /** The runner's existing entry for THIS event, on any distance. */
  myEntry: MyEntry | null;
}) {
  const remaining = Math.max(0, category.slots_total - category.slots_taken);
  const soldOut = remaining === 0;
  // Closed beats sold-out in the message: "Sold out" on a cancelled race tells
  // a runner to look for next year's edition of something that isn't running.
  // An entry is one PER EVENT, so `myEntry` re-labels every distance, not just
  // the one the runner picked — leaving "Join" live on the other distances
  // would walk them into a 409 they could have been told about here.
  const enterable = !soldOut && !closed && !myEntry;
  const scarce = !soldOut && remaining <= 15;
  const pct = Math.min(100, Math.round((category.slots_taken / Math.max(1, category.slots_total)) * 100));
  // The distance the runner actually holds reads as "here is your entry"; any
  // other distance of the same event reads as "you already have an entry,
  // elsewhere" — two different states, so they get two different treatments
  // below, not just swapped copy.
  const mine = myEntry?.categoryId === category.id;

  const facts: string[] = [];
  if (category.distance_km != null) facts.push(`${category.distance_km} km`);
  if (category.elevation_gain_m) facts.push(`${category.elevation_gain_m.toLocaleString()} m gain`);
  if (category.cutoff_hours) facts.push(`${category.cutoff_hours} h cut-off`);

  const rule = trail ? "border-white/12" : "border-black/10";
  const dim = trail ? "text-white/60" : "text-[#0B1220]/55";

  return (
    <Reveal
      as="li"
      delay={index * 0.06}
      className={`border-t ${rule} last:border-b ${mine ? (trail ? "bg-white/[0.03]" : "bg-black/[0.02]") : ""}`}
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto_180px] sm:gap-x-8 sm:py-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h3 className="font-display text-[clamp(1.5rem,4vw,2.6rem)] font-black uppercase leading-none tracking-[-0.5px]">
              {category.label}
            </h3>
            {/* "Your entry" beats the scarcity chip in this slot — once a runner
                has (or is finishing) an entry here, how many slots remain is no
                longer the fact that matters most about this row. */}
            {mine && myEntry ? (
              <span
                className={`font-eyebrow inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[1.5px] ${
                  myEntry.status === "paid"
                    ? "border-transparent bg-paid-tint text-paid"
                    : // Bordered, not just tinted: paid is a flat confirmation, pending
                      // carries a deadline and money, so it keeps a visible outline on
                      // top of the same tint/text pairing to read as the more urgent
                      // of the two — same border width on both to avoid a size jump.
                      "border-amber bg-amber-tint text-amber"
                }`}
              >
                {myEntry.status === "paid" ? (
                  <Check size={11} aria-hidden="true" />
                ) : (
                  <Clock size={11} aria-hidden="true" />
                )}
                {myEntry.status === "paid" ? "Your entry" : "Payment pending"}
              </span>
            ) : scarce ? (
              <span className="font-eyebrow rounded-full bg-amber-tint px-2.5 py-1 text-[10px] font-bold uppercase tracking-[1.5px] text-amber">
                {remaining} left
              </span>
            ) : null}
          </div>

          <p className={`font-mono-race mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] ${dim}`}>
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </p>

          {category.blurb ? (
            <p className={`mt-3 max-w-[52ch] text-[14.5px] leading-relaxed ${dim}`}>{category.blurb}</p>
          ) : null}

          {/* Fill bar doubles as scarcity signal without relying on colour
              alone — the width itself carries the message. */}
          <div className={`mt-4 h-[3px] w-full max-w-xs overflow-hidden rounded-full ${trail ? "bg-white/12" : "bg-black/10"}`}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Archivo, not the mono race face: JetBrains Mono has no PESO SIGN
            (U+20B1), so "₱" fell back to a system font and rendered larger and
            heavier than the digits next to it. Archivo carries ₱ AND tabular
            figures, and it is already the display face — so the price reads as
            the headline figure it is. Mono stays on the km/gain/cut-off data
            below, which never contains a currency symbol. */}
        <div className="self-start text-right font-display text-[clamp(1.1rem,2.6vw,1.6rem)] font-extrabold tabular-nums sm:self-center">
          {formatPeso(category.base_price)}
        </div>

        <div className="col-span-2 sm:col-span-1">
          {myEntry ? (
            mine ? (
              // The runner's own distance: a confirmation, not a call to
              // action to reconsider. Paid reads calm (tint, checkmark, no
              // border); pending reads urgent (same tint pairing but with a
              // visible amber border) because it is the one state here with
              // a deadline attached — see the badge above for why this is a
              // border and not a solid fill (WCAG contrast in a future dark
              // mode; StatusBadge.tsx's bg-*-tint/text-* is the established
              // pairing).
              <Link
                href={myEntry.status === "paid" ? "/races" : `/pay/${myEntry.id}`}
                aria-label={
                  myEntry.status === "paid"
                    ? `You're in — view entry — ${category.label}`
                    : `Finish payment — ${category.label}`
                }
                className={`inline-flex w-full items-center justify-center gap-1.5 rounded-pill border px-6 py-3 text-[14.5px] font-semibold ${
                  myEntry.status === "paid"
                    ? "border-transparent bg-paid-tint text-paid"
                    : "border-amber bg-amber-tint text-amber"
                }`}
              >
                {myEntry.status === "paid" ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Clock size={16} aria-hidden="true" />
                )}
                {myEntry.status === "paid" ? "You're in — view entry" : "Finish payment"}
              </Link>
            ) : (
              // A different distance of the same event: informative, not a
              // primary action — outlined rather than filled so it never
              // competes with the runner's actual entry above or a live
              // "Join" pill on another card.
              <Link
                href={myEntry.status === "paid" ? "/races" : `/pay/${myEntry.id}`}
                aria-label={
                  myEntry.status === "paid"
                    ? `${category.label} — you're registered on another distance`
                    : `${category.label} — payment pending on another distance`
                }
                className={`inline-flex w-full items-center justify-center gap-1.5 rounded-pill border px-6 py-3 text-[13.5px] font-semibold transition-colors ${
                  trail
                    ? "border-white/20 text-white/70 hover:bg-white/5"
                    : "border-black/15 text-black/60 hover:bg-black/5"
                }`}
              >
                <ArrowUpRight size={15} aria-hidden="true" />
                {myEntry.status === "paid" ? "Registered — other distance" : "Pending — other distance"}
              </Link>
            )
          ) : !enterable ? (
            <span
              className={`inline-flex w-full items-center justify-center rounded-pill px-6 py-3 text-[14.5px] font-semibold ${
                trail ? "bg-white/10 text-white/55" : "bg-black/5 text-black/45"
              }`}
            >
              {closed ? "Registration closed" : "Sold out"}
            </span>
          ) : (
            <RainbowButton asChild className="h-auto w-full rounded-pill px-6 py-3 text-[14.5px] font-semibold">
              <Link href={`/register/${category.id}`} aria-label={`Join ${category.label} — ${formatPeso(category.base_price)}`}>
                Join
              </Link>
            </RainbowButton>
          )}
        </div>
      </div>
    </Reveal>
  );
}
