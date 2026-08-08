import { Skeleton } from "@/components/ui/skeleton";

/** Profile: the passport card — full-bleed cover band (which carries the avatar
 *  and name), the three-figure strip, then the spec rows. The band keeps its real
 *  ratio so nothing below it jumps once the photo loads. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-12 sm:px-6 sm:py-14">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-9 w-56" />

      <div className="mt-8 overflow-hidden rounded-xl border border-border">
        <Skeleton className="aspect-[2/1] w-full rounded-none" />

        <div className="grid grid-cols-3 gap-3 border-y border-divider px-5 py-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>

        <div className="space-y-5 px-5 py-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
