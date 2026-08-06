"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-segment error boundary for everything under (admin) — Events,
 * Registrations, Payments, Team, Settings, the event editor. Before this
 * file existed there was NO error.tsx/global-error.tsx anywhere in the app:
 * every lib/queries/* reader ends in `throw error` with no page catching it
 * (see e.g. listOrgEvents/listOrgPayments/listEventRegistrations), so a
 * transient DB blip on any real page rendered Next's bare, unstyled error
 * screen — no sidebar, no topbar, no way back except a manual reload.
 *
 * This file lives in the (admin) route group, one level ABOVE each page —
 * Next renders an error.tsx in place of the failing segment's children
 * while the PARENT layout (app/(admin)/layout.tsx → AppShell, i.e. the
 * sidebar/topbar chrome) stays mounted. So a query failure here still shows
 * the app shell, just with this panel instead of the page body, plus a
 * "Try again" that calls `reset()` (Next's built-in retry — re-renders the
 * segment from scratch, re-running the failed query).
 *
 * Error boundaries must be Client Components (Next's own constraint) and
 * only catch errors in the segment they wrap, not in the layout itself —
 * an error thrown by AdminLayout (e.g. getMyRoles()) is NOT caught here and
 * still falls through to the root app/layout.tsx or Next's default screen.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The raw error is logged here, server-adjacent (this runs client-side,
    // but Next also logs the original server error to the terminal before
    // it ever reaches this boundary) — never rendered verbatim below. Same
    // "log the real thing, show something generic" rule the Server Actions
    // in lib/actions/* follow for driver errors.
    console.error("[admin] route segment error", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive-tint">
        <AlertCircle className="size-6 text-destructive" />
      </div>
      <div>
        <h2 className="text-[17px] font-bold">Something went wrong</h2>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          This page couldn&apos;t load. Try again, or come back in a moment.
        </p>
      </div>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
