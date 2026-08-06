import { Skeleton } from "@/components/ui/skeleton";

/**
 * The event page. The hero keeps its real height and the forest slab stays a
 * SOLID surface rather than a pulsing block — it is the page's anchor, and
 * flashing the whole viewport light-then-dark on every race a runner opens is
 * worse than a moment of plain colour.
 */
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-56 w-full rounded-none sm:h-80" />

      <div className="bg-forest px-5 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <Skeleton className="h-3 w-32 bg-white/15" />
          <Skeleton className="mt-3 h-9 w-4/5 bg-white/15 sm:h-12" />
          <Skeleton className="mt-3 h-4 w-64 bg-white/10" />
          <div className="mt-6 grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="rounded-lg border border-white/10 p-3">
                <Skeleton className="h-2.5 w-16 bg-white/10" />
                <Skeleton className="mt-2 h-6 w-20 bg-white/15" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="mt-4 rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-24 rounded-pill" />
            </div>
            <Skeleton className="mt-3 h-3 w-56" />
          </div>
        ))}
      </div>
    </div>
  );
}
