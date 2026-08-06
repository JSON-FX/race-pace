import { Skeleton } from "@/components/ui/skeleton";

/**
 * The races catalog: eyebrow, display heading, filter chips, then the 2-up
 * (mobile) / 3-up (desktop) card grid.
 *
 * Shaped like the real page so nothing jumps when the events land — the grid
 * columns and card aspect ratio are already reserved.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-11 w-56" />

      <div className="mt-6 flex flex-wrap gap-2">
        {[64, 92, 80, 56, 72, 60, 84].map((w, i) => (
          <Skeleton key={i} className="h-9 rounded-pill" style={{ width: w }} />
        ))}
      </div>

      <Skeleton className="mt-6 h-3 w-72" />

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-border">
            {/* Same 16/10 ratio the real card uses, so the grid height is right
                from the first paint. */}
            <Skeleton className="aspect-[16/10] rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-24" />
              <div className="flex gap-1.5 pt-1">
                <Skeleton className="h-5 w-11 rounded-pill" />
                <Skeleton className="h-5 w-11 rounded-pill" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
