import { Skeleton } from "@/components/ui/skeleton";

/** Registration: the step rail, then the form stack and the price summary. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-6">
      <div className="flex items-center gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-1.5 flex-1 rounded-pill" />
        ))}
      </div>

      <Skeleton className="mt-6 h-8 w-56" />
      <Skeleton className="mt-2 h-3 w-72" />

      <div className="mt-7 space-y-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i}>
            <Skeleton className="mb-2 h-3 w-28" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        ))}
      </div>

      <div className="mt-7 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-24" />
        </div>
      </div>
      <Skeleton className="mt-5 h-12 w-full rounded-pill" />
    </div>
  );
}
