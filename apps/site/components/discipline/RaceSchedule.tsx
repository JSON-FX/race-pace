import type { ScheduleItem } from "@/lib/events";

/**
 * `route` discipline only — a road race runs on a clock, a trail race
 * doesn't have one worth publishing this way. Empty `schedule` (the default,
 * and what the one real event actually has) omits the whole section rather
 * than rendering an empty list.
 */
export function RaceSchedule({ schedule }: { schedule: ScheduleItem[] }) {
  if (schedule.length === 0) return null;

  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto w-full max-w-5xl px-6">
        <p className="font-eyebrow text-[12px] font-bold uppercase tracking-[3px] text-primary">Race morning</p>
        <h2 className="mt-2 font-display text-[clamp(1.6rem,3.2vw,2.4rem)] font-black tracking-[-0.4px] text-foreground">
          How the day runs.
        </h2>
        <div className="mt-8 border-t border-divider">
          {schedule.map((item, i) => (
            <div key={i} className="grid grid-cols-[88px_1fr] items-baseline gap-5 border-b border-divider py-4 sm:grid-cols-[110px_1fr]">
              <time className="font-mono-race text-[15px] font-bold text-foreground">{item.time}</time>
              <p className="text-[15px] text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
