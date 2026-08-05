"use client";

import * as React from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarDays, MapPin, Flag, Timer, ChevronLeft, ChevronRight, Check, Navigation } from "lucide-react";
import { formatPeso, formatDateRange } from "@race-pace/shared";
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
  const reduced = useReducedMotion();
  const { start_lat: sLat, start_lng: sLng, finish_lat: fLat, finish_lng: fLng } = event;
  if (sLat == null || sLng == null) return null;

  // Same coordinates start and finish = a loop course, which is how both
  // seeded races actually run. Point-to-point renders two labelled markers.
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
            <CourseSvg loop={loop} dark={tone.dark} reduced={!!reduced} />
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
 * Stylized course locator, drawn as SVG.
 *
 * Deliberately NOT a tiled map: Leaflet/Mapbox would add a dependency, a
 * runtime request to a third-party tile host on every page view, and for
 * Mapbox an API key to manage. What a runner actually needs from this section
 * is "where is the start, and can I open it in my own maps app" — the real
 * coordinates power the Open in Maps button, which hands off to the app that
 * can already navigate. Say the word and I'll swap in real tiles.
 *
 * The route draws itself on entry via stroke-dashoffset, which animates on the
 * compositor and cannot cause layout shift.
 */
function CourseSvg({ loop, dark, reduced }: { loop: boolean; dark: boolean; reduced: boolean }) {
  const stroke = dark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)";
  const path = loop
    ? "M 200 118 C 118 108, 74 168, 108 214 C 140 258, 236 262, 272 220 C 310 176, 274 126, 200 118 Z"
    : "M 74 226 C 132 176, 158 210, 208 162 C 250 122, 288 138, 326 96";

  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" role="img" aria-label="Illustrative course locator">
      {/* Contour backdrop — texture, not data; it must never read as terrain
          the runner could navigate by. */}
      <g aria-hidden="true">
        {Array.from({ length: 9 }).map((_, i) => (
          <ellipse
            key={i}
            cx={200}
            cy={168}
            rx={38 + i * 26}
            ry={26 + i * 18}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
          />
        ))}
      </g>

      <motion.path
        d={path}
        fill="none"
        stroke="#159A55"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeDasharray={reduced ? undefined : 1400}
        initial={reduced ? false : { strokeDashoffset: 1400 }}
        whileInView={reduced ? undefined : { strokeDashoffset: 0 }}
        viewport={{ once: true, margin: "-15%" }}
        transition={{ duration: 1.5, ease: "easeInOut" }}
      />

      <Marker x={loop ? 200 : 74} y={loop ? 118 : 226} label={loop ? "Start / Finish" : "Start"} dark={dark} reduced={reduced} />
      {loop ? null : <Marker x={326} y={96} label="Finish" dark={dark} reduced={reduced} delay={1.1} />}
    </svg>
  );
}

function Marker({
  x,
  y,
  label,
  dark,
  reduced,
  delay = 0.35,
}: {
  x: number;
  y: number;
  label: string;
  dark: boolean;
  reduced: boolean;
  delay?: number;
}) {
  return (
    <motion.g
      initial={reduced ? false : { opacity: 0, scale: 0.6 }}
      whileInView={reduced ? undefined : { opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: `${x}px ${y}px` }}
    >
      {!reduced ? (
        <motion.circle
          cx={x}
          cy={y}
          r={10}
          fill="#159A55"
          initial={{ opacity: 0.5, scale: 1 }}
          animate={{ opacity: [0.5, 0, 0.5], scale: [1, 2.4, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut", delay }}
          style={{ transformOrigin: `${x}px ${y}px` }}
        />
      ) : null}
      <circle cx={x} cy={y} r={8} fill="#159A55" stroke={dark ? "#06120C" : "#fff"} strokeWidth={3} />
      <text
        x={x}
        y={y - 18}
        textAnchor="middle"
        fontSize={12}
        fontWeight={700}
        fill={dark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)"}
      >
        {label}
      </text>
    </motion.g>
  );
}
