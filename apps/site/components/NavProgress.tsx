"use client";

import * as React from "react";
import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * Navigation feedback: a top progress bar plus a per-link spinner.
 *
 * PORTED VERBATIM from the admin console (apps/web/components/NavProgress.tsx)
 * so both apps behave identically — same bar, same easing, same counter logic.
 * Kept as a copy rather than shared through packages/shared, which holds types
 * and pure logic and has never carried React components or Tailwind classes.
 *
 * The problem this solves is silence, not slowness. A Server-Component route
 * transition does nothing visible until the server responds — the browser holds
 * the OLD page, so a tap on a slow route reads as a tap that didn't land. On a
 * phone on mountain 3G that window is seconds, not milliseconds.
 * `loading.tsx` fixes the second half (what am I getting?) but only once the
 * navigation commits; this fixes the first half (did my tap register?).
 *
 * Built on Next's `useLinkStatus`, which reports pending state for the enclosing
 * <Link> and is only valid inside one — hence the split: <LinkPending> sits in
 * the link and reports upward, <NavProgressBar> renders at the layout root.
 *
 * A counter, not a boolean: prefetch and rapid clicks can overlap two pending
 * links, and a boolean would clear the bar when the FIRST resolves while the
 * second is still in flight.
 */

type Ctx = { begin: () => void; end: () => void; pending: boolean };
const NavProgressCtx = React.createContext<Ctx | null>(null);

export function NavProgressProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = React.useState(0);
  const begin = React.useCallback(() => setCount((n) => n + 1), []);
  const end = React.useCallback(() => setCount((n) => Math.max(0, n - 1)), []);
  const value = React.useMemo(() => ({ begin, end, pending: count > 0 }), [begin, end, count]);
  return <NavProgressCtx.Provider value={value}>{children}</NavProgressCtx.Provider>;
}

/**
 * Renders INSIDE a <Link>. Shows a spinner on the link itself and reports the
 * pending state to the bar.
 *
 * Safe outside a provider — it simply does nothing — so a stray <Link> can adopt
 * it without knowing whether the layout wired the bar up.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  const ctx = React.useContext(NavProgressCtx);

  React.useEffect(() => {
    if (!ctx || !pending) return;
    ctx.begin();
    // The cleanup runs when `pending` flips false OR the link unmounts
    // mid-navigation — which is the common case, since the new page replaces the
    // sidebar's rendered tree. Without balancing on unmount the counter would
    // leak and the bar would never clear.
    return () => ctx.end();
  }, [pending, ctx]);

  if (!pending) return null;

  return (
    <span
      role="status"
      aria-label="Loading page"
      className={cn(
        "ml-auto size-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary",
        // Spinning conveys nothing a reduced-motion user asked to see; the ring
        // still marks WHICH item is loading, which is the useful part.
        "motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/**
 * The bar itself. Renders at the layout root, above the content pane.
 *
 * Indeterminate by design: a Server-Component navigation exposes no progress
 * fraction, and a fake percentage that stalls at 90% is worse than an honest
 * "working". Hence no `aria-valuenow` — an indeterminate progressbar omits it
 * rather than lying with a number.
 */
export function NavProgressBar() {
  const ctx = React.useContext(NavProgressCtx);
  if (!ctx?.pending) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-busy="true"
      // `fixed`, not `absolute` as in the admin: there the bar lives inside a
      // `relative` SidebarInset, whereas here it sits directly in <body> and must
      // pin to the viewport. Safe from the backdrop-filter containing-block trap
      // that broke the old mobile sheet — this is a SIBLING of the blurred
      // header, not a descendant.
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2.5px] overflow-hidden bg-transparent"
    >
      <span
        className={cn(
          "block h-full w-[38%] rounded-r-full bg-primary shadow-[0_0_8px_rgba(21,154,85,0.5)]",
          "animate-nav-progress",
          // Reduced motion: a static full-width tint. Still unmistakably "this
          // page is working", with no travelling element.
          "motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-70",
        )}
      />
    </div>
  );
}
