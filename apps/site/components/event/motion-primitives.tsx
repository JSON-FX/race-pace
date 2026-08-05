"use client";

import * as React from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Motion primitives shared by both design directions.
 *
 * Every one of these checks `useReducedMotion()` and degrades to a static,
 * fully-legible end state — never a hidden one. That distinction matters: a
 * reveal implemented as `opacity: 0` + "animate on scroll" leaves content
 * permanently invisible for anyone with the OS setting on, or if the observer
 * never fires. Here the reduced-motion branch renders the final state
 * directly, so the page is complete without a single frame of animation.
 *
 * Durations sit in the 300–450ms band with ease-out entrances, per the motion
 * guidance: long enough to read as deliberate, short enough not to delay.
 */

/** Fade + rise as the element scrolls into view. `delay` staggers siblings. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 24,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li" | "span";
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  // once: the content settles and stays put — re-animating on every scroll-by
  // is the kind of motion that turns decorative and starts costing attention.
  const inView = useInView(ref, { once: true, margin: "-10% 0px -10% 0px" });
  const MotionTag = motion[as] as typeof motion.div;

  if (reduced) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <MotionTag
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 0.42, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </MotionTag>
  );
}

/** Scroll-linked parallax for hero media. Subtle by design — large offsets on
 *  a full-bleed photo read as disorientation, not depth. */
export function ParallaxLayer({
  children,
  className,
  distance = 90,
}: {
  children: React.ReactNode;
  className?: string;
  distance?: number;
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, distance]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.12]);

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y, scale }} className="h-full w-full will-change-transform">
        {children}
      </motion.div>
    </div>
  );
}

/** Counts up to `value` once visible. Race numbers — elevation, slots, gain —
 *  are the one place a count-up earns its keep: the motion says "this is a
 *  quantity worth reading" instead of decorating a static figure. */
export function CountUp({
  value,
  className,
  format = (n: number) => n.toLocaleString(),
}: {
  value: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const started = React.useRef(false);
  const [shown, setShown] = React.useState(reduced ? value : 0);

  const run = React.useCallback(() => {
    if (started.current) return;
    started.current = true;
    let raf = 0;
    const start = performance.now();
    const DURATION = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      // ease-out cubic: fast start, gentle settle — reads as arriving, not ramping.
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  React.useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }

    const el = ref.current;
    if (!el) return;

    // Start immediately when the element is ALREADY on screen at load. A
    // scroll-triggered observer alone never fires for above-the-fold content,
    // which left the hero stats reading "0 m gain · 0 slots left" until the
    // runner happened to scroll — wrong information, not merely a missing
    // animation, and the first thing seen on a phone.
    const rect = el.getBoundingClientRect();
    const visible = rect.top < window.innerHeight && rect.bottom > 0;
    if (visible) {
      run();
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      // No observer: show the real number rather than a permanent zero.
      setShown(value);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, run, value]);

  // tabular-nums stops the width jitter that would otherwise reflow the row
  // on every frame — the classic reason count-ups feel cheap.
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(shown)}
    </span>
  );
}

/** Edge-to-edge infinite marquee. Duplicated content + a 50% translate makes
 *  the loop seamless; aria-hidden on the copy so screen readers read it once. */
export function Marquee({
  children,
  className,
  seconds = 26,
  reverse = false,
}: {
  children: React.ReactNode;
  className?: string;
  seconds?: number;
  reverse?: boolean;
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div className={cn("overflow-hidden whitespace-nowrap", className)}>
        <div className="inline-flex">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden", className)}>
      <motion.div
        className="inline-flex w-max flex-nowrap"
        animate={{ x: reverse ? ["-50%", "0%"] : ["0%", "-50%"] }}
        transition={{ duration: seconds, ease: "linear", repeat: Infinity }}
      >
        <span className="inline-flex flex-nowrap">{children}</span>
        <span className="inline-flex flex-nowrap" aria-hidden="true">
          {children}
        </span>
      </motion.div>
    </div>
  );
}

/** Thin progress bar tied to page scroll — orientation for long poster pages. */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 180, damping: 30, mass: 0.3 });
  return (
    <motion.div
      style={{ scaleX }}
      className={cn("fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-primary", className)}
    />
  );
}

export type { MotionValue };
