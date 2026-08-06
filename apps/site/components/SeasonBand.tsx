"use client";

import { Reveal, CountUp } from "@/components/event/motion-primitives";

/**
 * Four season figures across a full-bleed band.
 *
 * These are the only numbers on the home page that describe Race Pace rather
 * than a single race, which is why they sit in their own band instead of
 * competing inside a card. Each counts up once on scroll-in via the existing
 * CountUp primitive — the same one the event hero uses, so reduced motion is
 * already handled and above-the-fold values never sit at zero.
 */
export function SeasonBand({
  races,
  distances,
  runners,
  provinces,
}: {
  races: number;
  distances: number;
  runners: number;
  provinces: number;
}) {
  const items = [
    { label: "Races open", value: races },
    { label: "Distances", value: distances },
    { label: "Runners entered", value: runners },
    { label: "Provinces", value: provinces },
  ];

  return (
    <section className="mt-16 border-y border-divider">
      <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-px bg-divider sm:grid-cols-4">
        {items.map((item, i) => (
          <div key={item.label} className="bg-background px-5 py-6 sm:px-6">
            <Reveal delay={i * 0.05}>
              <dt className="font-eyebrow text-[9.5px] font-bold uppercase tracking-[1.9px] text-muted-foreground">
                {item.label}
              </dt>
              <dd className="font-mono-race mt-1.5 text-[26px] font-bold tracking-[-1px] text-primary">
                <CountUp value={item.value} />
              </dd>
            </Reveal>
          </div>
        ))}
      </dl>
    </section>
  );
}
