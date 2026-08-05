"use client";

import Image from "next/image";
import Link from "next/link";
import { disciplineLayout, formatPeso, formatDateRange } from "@race-pace/shared";
import type { EventRow, CategoryRow, AddonRow } from "@/lib/events";
import { longDate } from "@/lib/format";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { Reveal, ParallaxLayer, CountUp, Marquee, ScrollProgress } from "./motion-primitives";
import {
  RaceEssentials,
  RaceMorning,
  WhatsIncluded,
  AddonsSection,
  GalleryCarousel,
  CourseLocator,
} from "./sections";

/**
 * DIRECTION B — "Kinetic Bib".
 *
 * Premise: the feeling in the corral thirty seconds before the gun. Loud,
 * physical, in motion. Distances are race bibs, not table rows — the object a
 * runner already associates with committing to a start line.
 *
 * Where Dossier persuades with evidence, Kinetic persuades with adrenaline.
 * Same data, opposite argument, so the two are genuinely a choice rather than
 * two coats of paint.
 *
 * Discipline branch:
 *  - profile (trail/ultra): near-black canvas, acid-green marquee, bibs as
 *    weathered field tags.
 *  - route (road/fun-run): bright green flood, speed rules, bibs as crisp
 *    printed race numbers.
 */
export function DirectionKinetic({
  event,
  categories,
  addons = [],
}: {
  event: EventRow;
  categories: CategoryRow[];
  addons?: AddonRow[];
}) {
  const layout = disciplineLayout(event.discipline);
  const trail = layout === "profile";
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const slotsLeft = categories.reduce((n, c) => n + Math.max(0, c.slots_total - c.slots_taken), 0);

  const shell = trail ? "bg-[#080A09] text-white" : "bg-[#F4F7F5] text-[#0A1410]";
  const tone = { dark: trail };

  return (
    <div className={shell}>
      <ScrollProgress />

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden">
        <ParallaxLayer className="absolute inset-0 -z-10" distance={70}>
          {event.hero_image_url ? (
            <Image src={event.hero_image_url} alt="" fill priority sizes="100vw" className="object-cover" />
          ) : (
            <div className="h-full w-full bg-forest" />
          )}
        </ParallaxLayer>
        <div className={`absolute inset-0 -z-10 ${trail ? "bg-[#080A09]/78" : "bg-[#04170E]/72"}`} />

        <div className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-8">
          <Reveal>
            <span className="font-eyebrow inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/15 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[2.5px] text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Registration open
            </span>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="mt-6 font-display text-[clamp(3rem,11vw,8.5rem)] font-black uppercase leading-[0.82] tracking-[-3px] text-white">
              {event.name}
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="font-mono-race mt-6 text-[13px] uppercase tracking-[2px] text-white/70 sm:text-[15px]">
              {[date, event.city_name, event.venue].filter(Boolean).join("  ·  ")}
            </p>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
              <RainbowButton asChild className="h-auto rounded-pill px-9 py-4 text-[17px] font-semibold">
                <a href="#bibs">Grab a bib</a>
              </RainbowButton>
              <p className="font-mono-race text-[13px] uppercase tracking-[1.5px] text-white/60">
                <CountUp value={slotsLeft} className="font-bold text-white" /> slots left ·{" "}
                <CountUp value={event.joined_count} className="font-bold text-white" /> joined
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Marquee ─────────────────────────────────────────────────────
          The kinetic signature. aria-hidden on the whole strip: it is
          decorative repetition, and a screen reader announcing the race name
          eight times is noise, not emphasis. */}
      <div
        aria-hidden="true"
        className={`border-y py-4 sm:py-6 ${trail ? "border-white/12 bg-primary text-[#04170E]" : "border-black/10 bg-[#0A1410] text-white"}`}
      >
        <Marquee seconds={trail ? 30 : 24} reverse={!trail}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="font-display px-6 text-[clamp(1.4rem,4vw,2.6rem)] font-black uppercase tracking-[-0.5px]"
            >
              {event.name} <span className="opacity-45">✦</span>
            </span>
          ))}
        </Marquee>
      </div>

      {/* ── Description ─────────────────────────────────────────────── */}
      {event.description ? (
        <section className="mx-auto w-full max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <p className="max-w-[58ch] text-[clamp(1.15rem,2.6vw,1.75rem)] font-medium leading-[1.45]">
              {event.description}
            </p>
          </Reveal>
        </section>
      ) : null}

      {/* ── Bibs ────────────────────────────────────────────────────── */}
      <section id="bibs" className="scroll-mt-16 px-5 pb-24 sm:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <Reveal>
            <h2 className="font-display text-[clamp(2rem,6vw,4rem)] font-black uppercase leading-[0.9] tracking-[-1.5px]">
              {trail ? "Claim your bib" : "Pick your race"}
            </h2>
          </Reveal>

          {/* auto-fit + minmax: the grid decides its own column count from the
              available width, so 1→2→3 columns happens continuously instead of
              snapping at hardcoded breakpoints. */}
          <div className="mt-10 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
            {categories.map((c, i) => (
              <Bib key={c.id} category={c} index={i} trail={trail} />
            ))}
          </div>
        </div>
      </section>

      {/* Gallery sits high in this direction — Kinetic sells the feeling
          first, so photographs of last year's race do more work here than
          they would after the logistics. */}
      <GalleryCarousel event={event} tone={tone} />
      <RaceEssentials event={event} tone={tone} />
      <CourseLocator event={event} tone={tone} />
      <RaceMorning event={event} tone={tone} />
      <WhatsIncluded event={event} tone={tone} />
      <AddonsSection addons={addons} tone={tone} />

      <section className={trail ? "border-t border-white/10" : "border-t border-black/10"}>
        <div className="mx-auto w-full max-w-6xl px-5 py-20 text-center sm:px-8 sm:py-28">
          <Reveal>
            <h2 className="font-display text-[clamp(2rem,6vw,4rem)] font-black uppercase leading-[0.9] tracking-[-1.5px]">
              Toe the line
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-8 flex justify-center">
              <RainbowButton asChild className="h-auto rounded-pill px-9 py-4 text-[16.5px] font-semibold">
                <a href="#bibs">Grab a bib</a>
              </RainbowButton>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

function Bib({ category, index, trail }: { category: CategoryRow; index: number; trail: boolean }) {
  const remaining = Math.max(0, category.slots_total - category.slots_taken);
  const soldOut = remaining === 0;
  const scarce = !soldOut && remaining <= 15;

  const facts: string[] = [];
  if (category.elevation_gain_m) facts.push(`${category.elevation_gain_m.toLocaleString()} m gain`);
  if (category.cutoff_hours) facts.push(`${category.cutoff_hours} h cut-off`);
  facts.push(soldOut ? "Sold out" : `${remaining} left`);

  const card = trail
    ? "border-white/14 bg-[#0E1512] hover:border-primary/70"
    : "border-black/10 bg-white hover:border-primary/70";

  return (
    <Reveal delay={index * 0.07}>
      {/* h-full + flex-col so every card in a row matches height and the CTA
          sits on a common baseline — the alignment problem raised earlier. */}
      <article
        className={`flex h-full flex-col rounded-2xl border-[1.5px] p-6 transition-colors duration-200 ${card} ${
          soldOut ? "opacity-60" : ""
        }`}
      >
        {/* Bib number: the distance, set like a race number with the
            perforated top edge implied by the dashed rule. */}
        <div className={`-mx-6 -mt-6 mb-5 rounded-t-2xl px-6 pb-4 pt-5 ${trail ? "bg-white/[0.04]" : "bg-[#0A1410]"}`}>
          <div className="font-mono-race flex items-baseline gap-1">
            <span
              className={`text-[clamp(2.6rem,7vw,3.6rem)] font-bold leading-none tabular-nums ${
                trail ? "text-primary" : "text-white"
              }`}
            >
              {category.distance_km ?? "—"}
            </span>
            <span className={`text-[15px] font-bold uppercase ${trail ? "text-primary/70" : "text-white/60"}`}>km</span>
          </div>
          <div className={`mt-1 font-display text-[17px] font-extrabold uppercase tracking-[0.5px] ${trail ? "text-white" : "text-white"}`}>
            {category.label}
          </div>
        </div>

        <div className={`font-mono-race flex flex-wrap gap-x-3 gap-y-1 text-[12px] ${trail ? "text-white/60" : "text-black/55"}`}>
          {facts.map((f, i) => (
            <span key={f} className={i === facts.length - 1 && scarce ? "font-bold text-amber" : undefined}>
              {f}
            </span>
          ))}
        </div>

        {category.blurb ? (
          <p className={`mt-4 text-[14px] leading-relaxed ${trail ? "text-white/70" : "text-black/65"}`}>
            {category.blurb}
          </p>
        ) : null}

        {/* mt-auto pins the price + CTA block to the bottom of every card
            regardless of how much copy sits above it. */}
        <div className={`mt-auto flex items-center justify-between gap-3 border-t pt-5 ${trail ? "border-white/10" : "border-black/10"}`}>
          <span className="font-mono-race text-[20px] font-bold tabular-nums">
            {formatPeso(category.base_price)}
          </span>
          {soldOut ? (
            <span className={`rounded-pill px-5 py-2.5 text-[14px] font-semibold ${trail ? "bg-white/10 text-white/55" : "bg-black/5 text-black/45"}`}>
              Sold out
            </span>
          ) : (
            <RainbowButton asChild className="h-auto rounded-pill px-5 py-2.5 text-[14px] font-semibold">
              <Link href={`/register/${category.id}`} aria-label={`Join ${category.label} — ${formatPeso(category.base_price)}`}>
                Join
              </Link>
            </RainbowButton>
          )}
        </div>
      </article>
    </Reveal>
  );
}
