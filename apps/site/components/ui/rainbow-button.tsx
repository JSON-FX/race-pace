import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Animated rainbow-bordered CTA.
 *
 * Two deliberate departures from the upstream snippet:
 *
 * 1. The gradient stops are `--rainbow-1..5`, not `--color-1..5`. In this
 *    codebase `--color-*` IS the Tailwind v4 theme namespace — globals.css
 *    maps `--color-primary: rgb(var(--primary))` inside `@theme inline` — so
 *    `--color-1` would read as a project design token and, if it ever moved
 *    into `@theme`, would generate a stray `bg-1` utility.
 *
 * 2. The face is trail-green (`--primary`), not the upstream `#121213`. A
 *    near-black CTA fights the theme, and driving it from the token means dark
 *    mode follows for free.
 *
 * 3. `asChild`, because every CTA this replaces is a `<Link>` or `<a>`, not a
 *    `<button>`. Without it the component could not be used on the CTAs it was
 *    added for, and nesting an <a> in a <button> is invalid HTML.
 *
 * The animation is suppressed under `prefers-reduced-motion` (see globals.css);
 * an infinite 2s loop is exactly what that setting exists to stop.
 */
export function RainbowButton({
  children,
  className,
  asChild = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      className={cn(
        "group relative inline-flex h-11 animate-rainbow cursor-pointer items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground transition-colors [background-clip:padding-box,border-box,border-box] [background-origin:border-box] [border:calc(0.08*1rem)_solid_transparent] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",

        // glow
        "before:absolute before:bottom-[-20%] before:left-1/2 before:z-0 before:h-1/5 before:w-3/5 before:-translate-x-1/2 before:animate-rainbow before:bg-[linear-gradient(90deg,hsl(var(--rainbow-1)),hsl(var(--rainbow-5)),hsl(var(--rainbow-3)),hsl(var(--rainbow-4)),hsl(var(--rainbow-2)))] before:bg-[length:200%] before:[filter:blur(calc(0.8*1rem))]",

        // Button face + rainbow edge. Driven by --primary (see .rainbow-surface
        // in globals.css) instead of the upstream near-black, so the CTA stays
        // trail-green and follows the theme into dark mode on its own — hence
        // no separate dark: variant here.
        "rainbow-surface",

        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}
