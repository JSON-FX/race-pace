import Image from "next/image";
import Link from "next/link";
import { formatPeso } from "@race-pace/shared";
import type { EventRow, CategoryRow } from "@/lib/events";
import { TopoPattern } from "@/components/TopoPattern";
import { ParallaxMedia } from "@/components/ParallaxMedia";
import { ScrollReveal } from "./ScrollReveal";
import { profileFillPath, profilePath, profilePoint } from "./courseCurve";

/**
 * `profile` discipline layout — trail / ultra / cross_country / obstacle.
 * One dark-forest canvas (the event's own featured image, heavily dimmed)
 * runs behind both the elevation-profile signature and the distances list
 * below it, so they read as one continuous course rather than two stacked
 * sections that happen to share a background.
 */
export function ProfileCourseSection({
  event,
  categories,
  closed,
}: {
  event: EventRow;
  categories: CategoryRow[];
  closed: boolean;
}) {
  const withDistance = categories
    .filter((c): c is CategoryRow & { distance_km: number } => c.distance_km != null)
    .sort((a, b) => a.distance_km - b.distance_km);
  const maxDistance = withDistance.at(-1)?.distance_km ?? null;

  const headline = event.elevation_gain_m
    ? `${event.elevation_gain_m.toLocaleString()} m of climbing, choose how far you go.`
    : "Watch the climb before you commit.";

  return (
    <section className="relative isolate overflow-hidden bg-forest py-20 sm:py-28">
      <ParallaxMedia className="absolute inset-0">
        {event.hero_image_url ? (
          <Image src={event.hero_image_url} alt="" fill sizes="100vw" className="object-cover" />
        ) : (
          <TopoPattern className="absolute inset-0 h-full w-full" />
        )}
      </ParallaxMedia>
      <div className="absolute inset-0 bg-forest/80" />
      <div className="absolute inset-0 bg-gradient-to-b from-forest via-forest/45 to-forest" />

      <div className="relative mx-auto w-full max-w-5xl px-6">
        <p className="font-eyebrow text-[12px] font-bold uppercase tracking-[3px] text-[#7FE0A6]">
          The course
        </p>
        <h2
          id="distances"
          className="mt-2 scroll-mt-24 font-display text-[clamp(1.9rem,4.2vw,3.1rem)] font-black leading-[0.98] tracking-[-1px] text-white"
        >
          {headline}
        </h2>

        {/* Signature: the elevation profile — see courseCurve.ts for why the
            line is illustrative while the checkpoint order is real. */}
        <ScrollReveal className="mt-14">
          <svg viewBox="0 0 1000 320" className="block w-full overflow-visible" role="img" aria-label="Illustrative elevation profile of the course">
            <defs>
              <linearGradient id="course-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#159A55" stopOpacity="0.38" />
                <stop offset="100%" stopColor="#159A55" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={profileFillPath()} fill="url(#course-fill)" />
            <path
              d={profilePath()}
              className="scroll-draw-path"
              fill="none"
              stroke="#7FE0A6"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {withDistance.map((c) => {
              const t = maxDistance ? c.distance_km / maxDistance : 0;
              const isFurthest = c.distance_km === maxDistance;
              const p = profilePoint(t);
              return (
                <g key={c.id}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isFurthest ? 7.5 : 6}
                    fill={isFurthest ? "#159A55" : "#071711"}
                    stroke={isFurthest ? "#fff" : "#7FE0A6"}
                    strokeWidth="2"
                  />
                  <text
                    x={p.x}
                    y={p.y - 16}
                    textAnchor="middle"
                    className="font-mono-race"
                    fontSize={isFurthest ? 12 : 10.5}
                    fontWeight={isFurthest ? 700 : 500}
                    fill={isFurthest ? "#7FE0A6" : "rgba(255,255,255,0.75)"}
                  >
                    {c.distance_km}K
                  </text>
                </g>
              );
            })}
          </svg>
        </ScrollReveal>

        {/* Distances as checkpoints on the course, not detached cards — same
            canvas, same photo. Fixed grid tracks (not `auto`) so the price
            and CTA columns line up down the whole list instead of sizing
            per row. */}
        <div className="mt-16">
          {categories.length === 0 ? (
            <p className="text-white/70">Distances haven&apos;t been published yet.</p>
          ) : (
            categories.map((c) => <CheckpointRow key={c.id} category={c} closed={closed} />)
          )}
        </div>
      </div>
    </section>
  );
}

function CheckpointRow({ category, closed }: { category: CategoryRow; closed: boolean }) {
  const soldOut = category.slots_taken >= category.slots_total;
  const remaining = Math.max(0, category.slots_total - category.slots_taken);
  const enterable = !soldOut && !closed;
  const scarce = !soldOut && remaining > 0 && remaining <= 15;

  const facts: string[] = [];
  if (category.elevation_gain_m) facts.push(`${category.elevation_gain_m.toLocaleString()} m gain`);
  if (category.cutoff_hours) facts.push(`${category.cutoff_hours} h cut-off`);
  facts.push(soldOut ? "Sold out" : `${remaining} ${remaining === 1 ? "slot" : "slots"} left`);

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 border-t border-white/10 py-6 last:border-b sm:grid-cols-[56px_1fr_130px_140px] sm:gap-x-6">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#7FE0A6]/40 bg-primary/10">
        <span className="font-mono-race text-[13px] font-bold text-[#7FE0A6]">
          {category.distance_km ?? "—"}
        </span>
      </div>

      <div className="col-start-2 sm:col-start-2">
        <div className="font-display text-[24px] font-extrabold tracking-[-0.5px] text-white">{category.label}</div>
        <div className="font-mono-race mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-white/65">
          {facts.map((f, i) => (
            <span key={i} className={i === facts.length - 1 && scarce ? "font-semibold text-amber" : undefined}>
              {f}
            </span>
          ))}
        </div>
      </div>

      <div className="font-mono-race col-start-2 text-[22px] font-extrabold tracking-[-0.4px] text-white sm:col-start-3 sm:text-right">
        {formatPeso(category.base_price)}
      </div>

      <div className="col-start-2 sm:col-start-4">
        {enterable ? (
          <Link
            href={`/register/${category.id}`}
            className="inline-flex w-full items-center justify-center rounded-pill bg-primary px-6 py-3 text-[14.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus sm:w-auto"
          >
            Enter — {formatPeso(category.base_price)}
          </Link>
        ) : (
          <span className="inline-flex w-full items-center justify-center rounded-pill bg-white/10 px-6 py-3 text-[14.5px] font-semibold text-white/60 sm:w-auto">
            {closed ? "Registration closed" : "Sold out"}
          </span>
        )}
      </div>
    </div>
  );
}
