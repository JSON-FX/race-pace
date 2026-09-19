"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import styles from "./LandingBackdrop.module.css";
import { cn } from "@/lib/utils";

export type LandingBackdropVariant = "ridge" | "atlas" | "start" | "journal" | "community";

const HERO_IMAGE = "/landing/trail-ridge-hero.webp";

function RouteLine() {
  return (
    <svg viewBox="0 0 700 330" fill="none" className="h-full w-full" aria-hidden="true">
      <path
        d="M18 284c90-80 142-25 210-92 62-61 107-54 158-111 53-59 107-76 194-40 40 16 71 4 101-23"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="5 10"
        strokeLinecap="round"
      />
      <path d="M18 284h76l28-48 46 8 32-88 48 39 54-73 49 29 35-70 61 24 53-61 62 7 39-33" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="284" r="8" fill="currentColor" />
      <circle cx="681" cy="18" r="8" fill="currentColor" />
    </svg>
  );
}

function Contours() {
  return (
    <svg viewBox="0 0 760 540" fill="none" className="h-full w-full" aria-hidden="true">
      {[
        "M-20 430C88 340 172 481 276 386c94-86 151 22 248-73 87-86 141-47 256-114",
        "M-26 382c120-87 190 28 292-55 106-85 162 0 257-81 92-79 161-38 269-99",
        "M-21 328c111-68 190 32 282-34 104-75 171-4 259-74 105-83 170-42 285-100",
        "M-16 270c104-54 192 35 276-19 105-68 175-6 258-66 101-75 173-52 294-107",
        "M-10 210c96-42 184 36 270-10 102-55 171-7 252-54 103-61 180-46 300-91",
      ].map((path) => <path key={path} d={path} stroke="currentColor" strokeWidth="1.6" />)}
    </svg>
  );
}

export function LandingBackdrop({ variant }: { variant: LandingBackdropVariant }) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = stage.current;
    const surface = node?.parentElement;
    if (!node || !surface) return;

    let frame = 0;
    let active = false;
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const reset = () => {
      if (!active) return;
      active = false;
      window.cancelAnimationFrame(frame);
      for (const key of ["slow-x", "slow-y", "mid-x", "mid-y", "fast-x", "fast-y"]) {
        node.style.setProperty(`--${key}`, "0px");
      }
    };

    const move = (event: PointerEvent) => {
      if (!finePointer.matches || reducedMotion.matches) {
        reset();
        return;
      }

      const rect = node.getBoundingClientRect();
      active = true;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        node.style.setProperty("--slow-x", `${(-x * 10).toFixed(1)}px`);
        node.style.setProperty("--slow-y", `${(-y * 8).toFixed(1)}px`);
        node.style.setProperty("--mid-x", `${(-x * 18).toFixed(1)}px`);
        node.style.setProperty("--mid-y", `${(-y * 14).toFixed(1)}px`);
        node.style.setProperty("--fast-x", `${(-x * 28).toFixed(1)}px`);
        node.style.setProperty("--fast-y", `${(-y * 20).toFixed(1)}px`);
      });
    };

    surface.addEventListener("pointermove", move, { passive: true });
    surface.addEventListener("pointerleave", reset);
    finePointer.addEventListener("change", reset);
    reducedMotion.addEventListener("change", reset);
    return () => {
      window.cancelAnimationFrame(frame);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", reset);
      finePointer.removeEventListener("change", reset);
      reducedMotion.removeEventListener("change", reset);
    };
  }, []);

  return (
    <div ref={stage} className={cn(styles.stage, styles[variant])} aria-hidden="true" data-testid={`landing-backdrop-${variant}`}>
      {variant === "ridge" ? (
        <>
          <div className={cn(styles.slow, styles.imageWrap)}>
            <Image src={HERO_IMAGE} alt="" fill priority sizes="100vw" className={styles.ridgeImage} />
          </div>
          <div className={styles.imageShade} />
          <div className={cn(styles.mid, styles.ridgeGlow)} />
          <div className={cn(styles.fast, styles.routeLine, "text-primary")}><RouteLine /></div>
        </>
      ) : null}

      {variant === "atlas" ? (
        <>
          <div className={cn(styles.slow, styles.atlasBase)} />
          <div className={cn(styles.mid, styles.atlasOrb)} />
          <div className={cn(styles.fast, styles.atlasContours)}><Contours /></div>
        </>
      ) : null}

      {variant === "start" ? (
        <>
          <div className={cn(styles.slow, styles.startBase)} />
          <div className={cn(styles.mid, styles.startGrid)} />
          <div className={cn(styles.fast, styles.startRing)} />
        </>
      ) : null}

      {variant === "journal" ? (
        <>
          <div className={cn(styles.slow, styles.journalPaper)} />
          <div className={cn(styles.mid, styles.journalImage)}>
            <Image src={HERO_IMAGE} alt="" fill priority sizes="(max-width: 767px) 85vw, 58vw" />
            <div className={styles.journalWash} />
          </div>
          <div className={cn(styles.fast, styles.journalStroke)} />
        </>
      ) : null}

      {variant === "community" ? (
        <>
          <div className={cn(styles.slow, styles.communityBase)} />
          <div className={cn(styles.mid, styles.communityCluster)}>
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className={styles.communityBubble}><span className={styles.communityDot} /></div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
