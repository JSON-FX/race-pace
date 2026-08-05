import type { EventRow, CategoryRow } from "@/lib/events";
import { ScrollReveal } from "./ScrollReveal";

/**
 * `route` discipline layout — road / marathon / half_marathon / fun_run.
 * Warm daylight canvas (no photo — the mockup's whole point is that this is
 * NOT the dark forest treatment). Signature is a route ribbon rather than an
 * elevation profile: a flat/closed-road race has no meaningful climb to
 * draw, which is exactly why disciplineLayout() exists.
 */
export function RouteSignatureSection({ event, categories }: { event: EventRow; categories: CategoryRow[] }) {
  const withDistance = categories
    .filter((c): c is CategoryRow & { distance_km: number } => c.distance_km != null)
    .sort((a, b) => a.distance_km - b.distance_km);

  const sub = event.description
    ? null // description already renders above; don't repeat it here
    : "One route, water stations along the way, and the same finish line for everyone.";

  return (
    <section className="bg-muted py-20 sm:py-28">
      <div className="mx-auto w-full max-w-5xl px-6">
        <p className="font-eyebrow text-[12px] font-bold uppercase tracking-[3px] text-primary">The route</p>
        <h2 id="distances" className="mt-2 scroll-mt-24 font-display text-[clamp(1.8rem,3.6vw,2.75rem)] font-black leading-[0.98] tracking-[-0.5px] text-foreground">
          One road, every distance turns back at its own marker.
        </h2>
        {sub ? <p className="mt-3 max-w-[52ch] text-[16px] text-muted-foreground">{sub}</p> : null}

        <ScrollReveal className="mt-12">
          <svg viewBox="0 0 1000 150" className="block w-full overflow-visible" role="img" aria-label="Illustrative route from start to finish">
            <path
              d="M20,96 C150,96 170,44 300,44 C430,44 450,104 580,104 C710,104 730,50 860,50 C960,50 1000,74 980,74"
              className="scroll-draw-path"
              fill="none"
              stroke="rgb(var(--primary))"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <circle cx="20" cy="96" r="9" fill="rgb(var(--coral))" />
            <text x="20" y="126" textAnchor="middle" className="font-mono-race" fontSize="11" fontWeight={700} fill="rgb(var(--foreground))">
              START
            </text>

            {withDistance.map((c, i, arr) => {
              const t = 0.18 + (i / Math.max(1, arr.length)) * 0.62;
              const x = 20 + t * 960;
              const y = 44 + 60 * Math.sin(t * Math.PI * 2.1);
              return (
                <g key={c.id}>
                  <circle cx={x} cy={y} r="6.5" fill="rgb(var(--muted))" stroke="rgb(var(--primary))" strokeWidth="2.5" />
                  <text x={x} y={y - 14} textAnchor="middle" className="font-mono-race" fontSize="11" fontWeight={700} fill="rgb(var(--foreground))">
                    {c.distance_km}K turn
                  </text>
                </g>
              );
            })}

            <circle cx="980" cy="74" r="9" fill="rgb(var(--primary))" />
            <text x="980" y="104" textAnchor="middle" className="font-mono-race" fontSize="11" fontWeight={700} fill="rgb(var(--foreground))">
              FINISH
            </text>
          </svg>
        </ScrollReveal>
      </div>
    </section>
  );
}
