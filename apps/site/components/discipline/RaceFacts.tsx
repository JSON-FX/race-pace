import type { EventRow } from "@/lib/events";

/**
 * `profile` discipline only — the one deliberately light slab in an
 * otherwise dark, photo-heavy layout. Each fact is independently optional;
 * a fact with no data is skipped from the grid entirely rather than
 * rendered as 0/—/an empty cell, so the empty-state event still looks
 * intentional instead of half-built.
 */
export function RaceFacts({ event }: { event: EventRow }) {
  const facts: { label: string; value: string }[] = [];
  if (event.flag_off) facts.push({ label: "Flag off", value: event.flag_off });
  if (event.elevation_gain_m) facts.push({ label: "Total climb", value: `${event.elevation_gain_m.toLocaleString()} m` });
  if (event.cutoff_hours) facts.push({ label: "Cut-off", value: `${event.cutoff_hours} h` });
  facts.push({ label: "Registered", value: `${event.joined_count} ${event.joined_count === 1 ? "runner" : "runners"}` });

  if (facts.length === 0) return null;

  return (
    <section className="bg-muted py-16 sm:py-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <p className="font-eyebrow text-[12px] font-bold uppercase tracking-[3px] text-primary">Race facts</p>
        <h2 className="mt-2 font-display text-[clamp(1.4rem,2.6vw,1.9rem)] font-black tracking-[-0.4px] text-foreground">
          What you&apos;re signing up for.
        </h2>
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="bg-muted px-5 py-6">
              <dt className="text-[10.5px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">{f.label}</dt>
              <dd className="font-mono-race mt-2 text-[22px] font-extrabold tracking-[-0.4px] text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
