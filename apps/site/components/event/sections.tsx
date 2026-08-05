"use client";

import * as React from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarDays, MapPin, Flag, Timer, ChevronLeft, ChevronRight, Check, Navigation } from "lucide-react";
import { formatPeso, formatDateRange, disciplineLayout } from "@race-pace/shared";
import type { EventRow, AddonRow } from "@/lib/events";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Reveal } from "./motion-primitives";

/**
 * Content sections shared by both design directions.
 *
 * Every section returns `null` when its data is absent — an organizer who has
 * not filled in a schedule gets no empty "Race morning" heading, and the page
 * simply gets shorter. That is the difference between a template and a page
 * that describes THIS race.
 *
 * `tone` carries the discipline's canvas so a single component can sit on the
 * trail's near-black or the road's light surface without either one hardcoding
 * colours at the call site.
 */
export type Tone = { dark: boolean };

function Section({
  title,
  kicker,
  tone,
  children,
  className,
}: {
  title: string;
  kicker?: string;
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t", tone.dark ? "border-white/10" : "border-black/10", className)}>
      <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <Reveal>
          {kicker ? (
            <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[3px] text-primary">{kicker}</p>
          ) : null}
          <h2 className="mt-2 font-display text-[clamp(1.7rem,4.6vw,3rem)] font-black uppercase leading-[0.95] tracking-[-1px]">
            {title}
          </h2>
        </Reveal>
        <div className="mt-8 sm:mt-10">{children}</div>
      </div>
    </section>
  );
}

/* ── Essentials ──────────────────────────────────────────────────────────
   The four questions every runner asks before anything else. Icons carry
   meaning alongside the label, never instead of it. */
export function RaceEssentials({ event, tone }: { event: EventRow; tone: Tone }) {
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const where = [event.venue, event.city_name, event.province_name].filter(Boolean).join(", ");

  const items = [
    { icon: CalendarDays, label: "Race day", value: date },
    { icon: MapPin, label: "Where", value: where || null },
    // flag_off arrives as a Postgres `time` ("04:30:00"); trim the seconds a
    // runner will never care about.
    { icon: Flag, label: "Flag off", value: event.flag_off ? event.flag_off.slice(0, 5) : null },
    { icon: Timer, label: "Cut-off", value: event.cutoff_hours ? `${event.cutoff_hours} hours` : null },
  ].filter((i) => i.value);

  if (items.length === 0) return null;

  return (
    <Section title="The essentials" kicker="Know before you go" tone={tone}>
      <dl className="grid gap-px overflow-hidden rounded-xl bg-current/10 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => (
          <Reveal key={item.label} delay={i * 0.05}>
            <div className={cn("flex h-full gap-4 p-5", tone.dark ? "bg-[#0C1410]" : "bg-white")}>
              <item.icon size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="font-eyebrow text-[10.5px] font-bold uppercase tracking-[2px] opacity-55">
                  {item.label}
                </dt>
                <dd className="mt-1 text-[15.5px] font-semibold leading-snug">{item.value}</dd>
              </div>
            </div>
          </Reveal>
        ))}
      </dl>
    </Section>
  );
}

/* ── Race morning schedule ───────────────────────────────────────────── */
export function RaceMorning({ event, tone }: { event: EventRow; tone: Tone }) {
  const schedule = (event.schedule ?? []).filter((s) => s && (s.time || s.label));
  if (schedule.length === 0) return null;

  return (
    <Section title="Race morning" kicker="Minute by minute" tone={tone}>
      {/* A timeline, not a table: the vertical rule and dots say "these happen
          in order" without a column header explaining it. */}
      <ol className="relative">
        <div
          aria-hidden="true"
          className={cn("absolute bottom-4 left-[7px] top-3 w-px", tone.dark ? "bg-white/15" : "bg-black/12")}
        />
        {schedule.map((row, i) => (
          <Reveal as="li" key={i} delay={i * 0.07} className="relative flex gap-5 pb-7 last:pb-0">
            <span
              className={cn(
                "relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px]",
                tone.dark ? "border-[#06120C]" : "border-white",
                "bg-primary",
              )}
            />
            <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-6">
              <time className="font-mono-race block text-[17px] font-bold tabular-nums text-primary sm:w-[76px] sm:shrink-0">
                {row.time}
              </time>
              <p className="mt-0.5 text-[15.5px] font-medium leading-snug sm:mt-0">{row.label}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

/* ── Inclusions ─────────────────────────────────────────────────────── */
export function WhatsIncluded({ event, tone }: { event: EventRow; tone: Tone }) {
  const inclusions = (event.inclusions ?? []).filter(Boolean);
  if (inclusions.length === 0) return null;

  return (
    <Section title="In your entry" kicker="What's included" tone={tone}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {inclusions.map((item, i) => (
          <Reveal as="li" key={item} delay={i * 0.05}>
            <div
              className={cn(
                "flex h-full items-center gap-3 rounded-xl border p-4",
                tone.dark ? "border-white/12 bg-white/[0.03]" : "border-black/10 bg-black/[0.02]",
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary">
                <Check size={15} className="text-white" aria-hidden="true" />
              </span>
              <span className="text-[15px] font-medium leading-snug">{item}</span>
            </div>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}

/* ── Add-ons ────────────────────────────────────────────────────────── */
export function AddonsSection({ addons, tone }: { addons: AddonRow[]; tone: Tone }) {
  if (addons.length === 0) return null;

  return (
    <Section title="Make it yours" kicker="Optional add-ons" tone={tone}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {addons.map((a, i) => (
          <Reveal as="li" key={a.id} delay={i * 0.06}>
            <div
              className={cn(
                "flex h-full items-center justify-between gap-4 rounded-xl border p-5",
                tone.dark ? "border-white/12 bg-white/[0.03]" : "border-black/10 bg-white",
              )}
            >
              <span className="text-[15.5px] font-semibold leading-snug">{a.name}</span>
              <span className="font-mono-race shrink-0 text-[15px] font-bold tabular-nums text-primary">
                +{formatPeso(a.price)}
              </span>
            </div>
          </Reveal>
        ))}
      </ul>
      <p className="mt-4 text-[13.5px] opacity-60">Add these while you register — no need to decide now.</p>
    </Section>
  );
}

/* ── Gallery carousel ───────────────────────────────────────────────── */
export function GalleryCarousel({ event, tone }: { event: EventRow; tone: Tone }) {
  const images = (event.gallery ?? []).filter(Boolean);
  const [index, setIndex] = React.useState(0);
  const [dir, setDir] = React.useState(1);
  const reduced = useReducedMotion();

  if (images.length === 0) return null;

  const go = (next: number) => {
    setDir(next > index ? 1 : -1);
    setIndex((next + images.length) % images.length);
  };

  return (
    <Section title="Last year" kicker="On the course" tone={tone}>
      <div className="relative overflow-hidden rounded-2xl">
        <div className="relative aspect-[16/10] sm:aspect-[21/9]">
          {/* mode="popLayout" so the outgoing slide leaves while the incoming
              one arrives — a plain swap flashes the background between them. */}
          <AnimatePresence initial={false} mode="popLayout" custom={dir}>
            <motion.div
              key={index}
              custom={dir}
              className="absolute inset-0"
              initial={reduced ? false : { opacity: 0, x: dir * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: dir * -60 }}
              transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
            >
              <Image
                src={images[index]!}
                alt={`${event.name} — photo ${index + 1} of ${images.length}`}
                fill
                sizes="(max-width: 768px) 100vw, 1100px"
                className="object-cover"
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {images.length > 1 ? (
          <>
            <CarouselButton side="left" onClick={() => go(index - 1)} label="Previous photo" />
            <CarouselButton side="right" onClick={() => go(index + 1)} label="Next photo" />
            {/* Dots are ≥44px tall via padding even though the visual dot is
                small — the tap target is what has to clear the minimum. */}
            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 pb-1">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Go to photo ${i + 1}`}
                  aria-current={i === index}
                  className="group px-2 py-4"
                >
                  <span
                    className={cn(
                      "block h-1.5 rounded-full transition-all duration-200",
                      i === index ? "w-7 bg-white" : "w-1.5 bg-white/50 group-hover:bg-white/80",
                    )}
                  />
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Section>
  );
}

function CarouselButton({
  side,
  onClick,
  label,
}: {
  side: "left" | "right";
  onClick: () => void;
  label: string;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}

/* ── Course locator ─────────────────────────────────────────────────── */
export function CourseLocator({ event, tone }: { event: EventRow; tone: Tone }) {
  const { start_lat: sLat, start_lng: sLng, finish_lat: fLat, finish_lng: fLng } = event;
  if (sLat == null || sLng == null) return null;

  // Same coordinates start and finish = a loop course, which is how both
  // seeded races actually run.
  const loop = fLat == null || fLng == null || (Math.abs(fLat - sLat) < 1e-6 && Math.abs(fLng - sLng) < 1e-6);
  const maps = `https://www.google.com/maps/search/?api=1&query=${sLat},${sLng}`;

  return (
    <Section title={loop ? "Start & finish" : "Start to finish"} kicker="The course" tone={tone}>
      <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <Reveal>
          <div
            className={cn(
              "relative aspect-[4/3] overflow-hidden rounded-2xl border sm:aspect-[16/10]",
              tone.dark ? "border-white/12 bg-[#08150F]" : "border-black/10 bg-[#F2F6F3]",
            )}
          >
            {/* Terrain only where the vertical is the story — see CourseMap. */}
            <LazyMount>
              <CourseMap
                lat={sLat}
                lng={sLng}
                finishLat={fLat ?? null}
                finishLng={fLng ?? null}
                route={event.route ?? null}
                terrain={disciplineLayout(event.discipline) === "profile"}
                dark={tone.dark}
                label={event.venue ?? event.name}
              />
            </LazyMount>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div>
            <p className="text-[17px] font-semibold leading-snug">
              {event.venue ?? event.city_name ?? "Start line"}
            </p>
            <p className="mt-1 text-[15px] opacity-70">
              {[event.city_name, event.province_name].filter(Boolean).join(", ")}
            </p>
            <p className="font-mono-race mt-4 text-[13px] tabular-nums opacity-60">
              {sLat.toFixed(5)}, {sLng.toFixed(5)}
            </p>
            <p className="mt-4 max-w-[46ch] text-[14.5px] leading-relaxed opacity-75">
              {loop
                ? "A loop course — you finish where you started, so drop bags and support stay in one place."
                : "A point-to-point course. Plan transport back to the start, or use the organizer's shuttle."}
            </p>
            <a
              href={maps}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-pill bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
            >
              <Navigation size={16} aria-hidden="true" />
              Open in Maps
            </a>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/**
 * MapLibre is ~266 KB gzipped — far too much to put in the initial bundle for
 * a section most visitors scroll past. Two guards:
 *
 *  1. next/dynamic with ssr:false — the library never enters the server render
 *     or the first-load JS (it also touches `window` at import time, so SSR
 *     would throw regardless).
 *  2. LazyMount below — the chunk is not even requested until the section is
 *     within 300px of the viewport.
 *
 * A runner who never scrolls to the map never pays for it.
 */
const CourseMap = dynamic(() => import("./CourseMap").then((m) => m.CourseMap), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

function MapSkeleton() {
  return (
    <div className="absolute inset-0 animate-pulse bg-current/[0.06]" aria-hidden="true" />
  );
}

/** Renders `children` only once the wrapper nears the viewport. rootMargin
 *  starts the fetch just before the map is needed, so it is usually painted by
 *  the time it scrolls in. */
function LazyMount({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old browser): render immediately rather
    // than leaving a permanently empty frame.
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="absolute inset-0">
      {show ? children : <MapSkeleton />}
    </div>
  );
}
