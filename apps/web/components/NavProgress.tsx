"use client";

import * as React from "react";
import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * Navigation feedback: a top progress bar plus a per-link spinner.
 *
 * The problem this solves is silence, not slowness. A Server-Component route
 * transition does nothing visible until the server responds — the browser holds
 * the OLD page, so a click on a slow route reads as a click that didn't land.
 * `loading.tsx` fixes the second half (what am I getting?) but only once the
 * navigation commits; this fixes the first half (did my click register?),
 * which is the question the operator is actually asking.
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
 * Reports an arbitrary pending state to the nav bar.
 *
 * Extracted from <LinkPending> so navigations that are NOT <Link> clicks can
 * drive the same bar: the event pickers and every `useTableParams` write
 * (pagination, sort, filters, search) go through `router.push`, which
 * `useLinkStatus` cannot see. Without this they were completely silent —
 * the operator clicked and the page sat there.
 *
 * Safe with no provider mounted: it simply does nothing, so a hook as widely
 * used as `useTableParams` can call it unconditionally.
 */
export function useReportPending(pending: boolean) {
  const ctx = React.useContext(NavProgressCtx);

  React.useEffect(() => {
    if (!ctx || !pending) return;
    ctx.begin();
    // Cleanup runs when `pending` flips false OR the caller unmounts
    // mid-navigation — the common case, since the new page replaces the old
    // tree. Without balancing on unmount the counter leaks and the bar sticks.
    return () => ctx.end();
  }, [pending, ctx]);
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
  useReportPending(pending);

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
      className="pointer-events-none absolute inset-x-0 top-0 z-50 h-[2.5px] overflow-hidden bg-transparent"
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
