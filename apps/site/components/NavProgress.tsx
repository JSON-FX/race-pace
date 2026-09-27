"use client";

import * as React from "react";
import { useLinkStatus } from "next/link";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
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
    <Spinner aria-label="Loading page" className={cn("ml-auto size-3 shrink-0 motion-reduce:animate-none", className)} />
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
    <Progress value={null} aria-label="Loading page" aria-busy="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2.5px] rounded-none bg-transparent"
      indicatorClassName="w-[38%] animate-nav-progress rounded-r-full motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-70" />
  );
}
