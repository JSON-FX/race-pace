"use client";

import { useEffect, useRef } from "react";
import {
  DEFAULT_PARALLAX_MAX_OFFSET,
  parallaxOffset,
  type ParallaxConfig,
} from "@/lib/parallax";

/**
 * Wraps a hero's media (a `fill` next/image or the TopoPattern SVG fallback)
 * and drifts it a few dozen pixels slower than the page scrolls — the
 * standard depth cue, without any of the ways it usually breaks:
 *
 * - `background-attachment: fixed` is skipped entirely (broken/disabled on
 *   iOS Safari) in favour of a `transform: translate3d` driven by rAF.
 * - The media is painted oversized (extra height above and below, from
 *   `maxOffset`) so a translate never pulls an edge past the section's
 *   bounds — no white sliver at the top or bottom mid-scroll.
 * - `prefers-reduced-motion: reduce` disables the effect outright: no
 *   listeners are attached and the media sits at its resting (untranslated)
 *   position, which the oversize buffer keeps gap- and clip-free on its own.
 * - Only `transform` is written, and only inside a rAF callback gated by an
 *   IntersectionObserver, so off-screen heroes cost nothing and on-screen
 *   ones never do layout-triggering work per scroll event.
 *
 * The caller keeps the scrim/gradient layers as siblings outside this
 * component — they must scroll with the section, not the image.
 */
export function ParallaxMedia({
  children,
  className,
  maxOffset = DEFAULT_PARALLAX_MAX_OFFSET,
  factor,
}: {
  children: React.ReactNode;
  className?: string;
  maxOffset?: number;
  factor?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const media = mediaRef.current;
    if (!wrapper || !media) return;

    const supportsMatchMedia = typeof window.matchMedia === "function";
    const reduceQuery = supportsMatchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

    // Reduced motion: leave the media untransformed (its resting position
    // is already correct — see the render below) and skip every listener.
    if (reduceQuery?.matches) return;

    // No IntersectionObserver support: don't guess, just stay static rather
    // than risk an unthrottled/unscoped scroll handler.
    if (typeof IntersectionObserver === "undefined") return;

    const config: ParallaxConfig = { maxOffset, factor, reducedMotion: false };

    let sectionTop = 0;
    let visible = false;
    let ticking = false;
    let rafId: number | null = null;

    const measure = () => {
      sectionTop = wrapper.getBoundingClientRect().top + window.scrollY;
    };

    const apply = () => {
      ticking = false;
      if (!visible) return;
      const offset = parallaxOffset(window.scrollY, sectionTop, config);
      media.style.transform = `translate3d(0, ${offset}px, 0)`;
    };

    const schedule = () => {
      if (ticking) return;
      ticking = true;
      rafId = requestAnimationFrame(apply);
    };

    const onScroll = () => schedule();
    const onResize = () => {
      measure();
      schedule();
    };

    measure();

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? false;
        if (visible) schedule();
      },
      { rootMargin: "25% 0px" },
    );
    io.observe(wrapper);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    const onReduceChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        media.style.transform = "";
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        io.disconnect();
      }
    };
    reduceQuery?.addEventListener?.("change", onReduceChange);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      io.disconnect();
      reduceQuery?.removeEventListener?.("change", onReduceChange);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [maxOffset, factor]);

  return (
    <div ref={wrapperRef} className={className ?? "absolute inset-0"}>
      {/* Oversized by `maxOffset` above and below so the rAF translate above
          (0..maxOffset, downward only) never uncovers the section's edge.
          At rest (transform unset — the reduced-motion case too) this
          buffer is inert: object-cover/preserveAspectRatio="none" media
          still exactly fills the wrapper's cross-axis and the extra height
          simply sits clipped by the section's own `overflow-hidden`. */}
      <div
        ref={mediaRef}
        data-testid="parallax-media"
        className="absolute inset-x-0 h-full w-full"
        style={{ top: -maxOffset, bottom: -maxOffset, height: `calc(100% + ${maxOffset * 2}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
