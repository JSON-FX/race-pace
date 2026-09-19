"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import styles from "./CourseAtlasMedia.module.css";

export type CourseAtlasScene = "hero" | "journey" | "preparation" | "finish";

export function CourseAtlasMedia({
  scene,
  src,
  priority = false,
}: {
  scene: CourseAtlasScene;
  src: string;
  priority?: boolean;
}) {
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
      for (const key of ["photo-x", "photo-y"]) {
        node.style.setProperty(`--${key}`, "0px");
      }
    };

    const move = (event: PointerEvent) => {
      if (!finePointer.matches || reducedMotion.matches) {
        reset();
        return;
      }

      const rect = surface.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      active = true;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        node.style.setProperty("--photo-x", `${(-x * 12).toFixed(1)}px`);
        node.style.setProperty("--photo-y", `${(-y * 9).toFixed(1)}px`);
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
    <div
      ref={stage}
      className={cn(styles.stage, styles[scene])}
      aria-hidden="true"
      data-testid={`course-atlas-media-${scene}`}
    >
      <div className={styles.photo}>
        <Image
          src={src}
          alt=""
          fill
          priority={priority}
          sizes="100vw"
          className={styles.image}
        />
      </div>
      <div className={styles.scrim} />
    </div>
  );
}
