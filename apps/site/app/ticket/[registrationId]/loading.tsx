import { Skeleton } from "@/components/ui/skeleton";

/**
 * The digital ticket — the one screen a runner opens AT the start line, often on
 * a bad connection. The QR block keeps its exact square so the code lands in the
 * same place it was reserved, rather than shifting under a thumb already moving
 * toward it.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-10 sm:px-6">
      <div className="overflow-hidden rounded-2xl border border-border">
        <div className="bg-forest p-5">
          <Skeleton className="h-3 w-24 bg-white/15" />
          <Skeleton className="mt-2.5 h-7 w-3/4 bg-white/15" />
          <Skeleton className="mt-2 h-3 w-40 bg-white/10" />
        </div>
        <div className="grid place-items-center p-6">
          <Skeleton className="aspect-square w-full max-w-[260px] rounded-xl" />
        </div>
        <div className="space-y-3 border-t border-divider p-5">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
