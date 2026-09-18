"use client";

import { useEffect, useRef } from "react";
import styles from "./coming-soon.module.css";

export function HorizonScene() {
  const mountain = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 721px)");
    let frame = 0;

    const reset = () => {
      window.cancelAnimationFrame(frame);
      mountain.current?.style.setProperty("--shift-x", "0px");
      mountain.current?.style.setProperty("--shift-y", "0px");
    };
    const move = (event: PointerEvent) => {
      if (!pointer.matches || !desktop.matches || reducedMotion.matches) {
        reset();
        return;
      }
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const x = (event.clientX / window.innerWidth - .5) * 2;
        const y = (event.clientY / window.innerHeight - .5) * 2;
        mountain.current?.style.setProperty("--shift-x", `${(-x * 28).toFixed(1)}px`);
        mountain.current?.style.setProperty("--shift-y", `${(-y * 28).toFixed(1)}px`);
      });
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", reset);
    pointer.addEventListener("change", reset);
    reducedMotion.addEventListener("change", reset);
    desktop.addEventListener("change", reset);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", reset);
      pointer.removeEventListener("change", reset);
      reducedMotion.removeEventListener("change", reset);
      desktop.removeEventListener("change", reset);
    };
  }, []);

  return <div className={styles.scene} aria-hidden="true"><div ref={mountain} className={styles.mountain} /></div>;
}
