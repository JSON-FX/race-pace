import { Skeleton } from "@/components/ui/skeleton";

/** My Races: heading, the Upcoming/Finished tabs, then entry cards. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-10 w-48" />

      <div className="mt-6 flex gap-6 border-b border-divider pb-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-24" />
      </div>

      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="mt-4 flex gap-4 rounded-xl border border-border p-4">
          <Skeleton className="size-20 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-6 w-24 rounded-pill" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-10 w-32 rounded-pill" />
              <Skeleton className="h-10 w-32 rounded-pill" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
