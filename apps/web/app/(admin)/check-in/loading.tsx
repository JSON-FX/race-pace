import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The dark scan bar, then the two roster tables. The bar keeps its forest
 *  surface while loading — it is the page's anchor, and skeletonising it would
 *  make the whole screen flash light-then-dark on every event switch. */
export default function Loading() {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <Skeleton className="mb-4 h-7 w-56" />

      <div className="mb-4 rounded-xl bg-forest p-4">
        <Skeleton className="h-4 w-40 bg-white/15" />
        <Skeleton className="mt-3 h-12 w-full bg-white/10" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, col) => (
          <Card key={col} className="gap-0 rounded-xl border py-0 shadow-card">
            <div className="border-b p-4"><Skeleton className="h-4 w-36" /></div>
            <div className="border-b p-3"><Skeleton className="h-8 w-full" /></div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 border-b p-3 last:border-b-0">
                <Skeleton className="size-6 rounded-md" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
