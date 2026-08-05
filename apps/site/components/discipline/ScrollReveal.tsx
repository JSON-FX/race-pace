"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps the course-profile / route-ribbon signature graphic and flips on a
 * `data-shown` attribute once it scrolls into view, so the SVG's own CSS
 * (stroke-dasharray/-dashoffset transition) can "draw" the line on.
 *
 * Mirrors ParallaxMedia's reduced-motion contract on purpose (same shape,
 * different effect — this is not a second parallax implementation):
 * `prefers-reduced-motion: reduce` skips the IntersectionObserver entirely
 * and shows the fully-drawn graphic immediately, no listeners attached.
 */
export function ScrollReveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const supportsMatchMedia = typeof window.matchMedia === "function";
    const reduce = supportsMatchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} data-shown={shown || undefined} className={cn(className)}>
      {children}
    </div>
  );
}
