"use client";

import * as React from "react";
import Link from "next/link";
import type { EventRow } from "@/lib/events";
import { EventCard } from "@/components/EventCard";
import { Reveal } from "@/components/event/motion-primitives";

/**
 * The "Opening soon" rail — a horizontal, scroll-snapped strip of races.
 *
 * A rail rather than a second grid: home curates and /events filters, and if
 * both rendered the same grid there'd be no reason to visit the other one.
 * That was literally the bug in the old pages — `/` and `/events` produced
 * identical markup.
 *
 * The progress bar is driven by real scroll position, not a fixed guess, so
 * it also serves as the affordance that there IS more to the right. Native
 * scrolling throughout: no JS-driven transform, so the rail keeps momentum,
 * keyboard scrolling and trackpad gestures for free.
 */
export function RaceRail({ events }: { events: EventRow[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [progress, setProgress] = React.useState(0);

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // Everything fits: a full-width bar reads as "you've seen it all", which
    // is true, and beats a zero-width bar that looks broken.
    setProgress(max <= 1 ? 1 : el.scrollLeft / max);
  }, []);

  React.useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pt-14 sm:px-6 sm:pt-16">
      <Reveal>
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="font-display text-[20px] font-extrabold tracking-[-0.5px] text-foreground sm:text-[24px]">
            Opening soon
          </h2>
          <Link href="/events" className="text-[13px] font-semibold text-primary hover:text-primary-focus">
            View all →
          </Link>
        </div>
      </Reveal>

      <div
        ref={ref}
        onScroll={measure}
        className="-mx-5 mt-5 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-5 pb-2 sm:-mx-6 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {events.map((e, i) => (
          <div key={e.id} className="w-[214px] shrink-0 snap-start">
            <Reveal delay={Math.min(i, 5) * 0.05}>
              <EventCard event={e} index={i + 2} />
            </Reveal>
          </div>
        ))}
      </div>

      <div aria-hidden="true" className="mt-3 h-[3px] overflow-hidden rounded-pill bg-divider">
        <div
          className="h-full rounded-pill bg-primary transition-[width,margin] duration-150"
          style={{
            // Thumb width tracks how much of the rail is visible; its offset
            // tracks how far along you are. Same shape as a scrollbar, because
            // that is exactly what a reader already knows how to interpret.
            width: `${Math.max(18, 100 / Math.max(1, events.length / 2.5))}%`,
            marginLeft: `${progress * (100 - Math.max(18, 100 / Math.max(1, events.length / 2.5)))}%`,
          }}
        />
      </div>
    </section>
  );
}
