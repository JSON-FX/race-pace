import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped like the real dashboard — four KPI tiles, then the chart and fill-rate
 * pair, then the upcoming-events table. Matching the true layout is the point:
 * the page must not jump when data lands, which a centred spinner guarantees it
 * will.
 */
export default function Loading() {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <Skeleton className="mb-5 h-7 w-40" />

      <div className="mb-[18px] grid grid-cols-2 gap-3 min-[760px]:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="gap-0 rounded-xl border px-[15px] py-[14px] shadow-card">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-[9px] h-6 w-28" />
            <Skeleton className="mt-2 h-3 w-20" />
          </Card>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <Card className="gap-0 rounded-xl border py-0 shadow-card">
          <div className="border-b p-4"><Skeleton className="h-4 w-36" /></div>
          <div className="p-4"><Skeleton className="h-[130px] w-full" /></div>
        </Card>
        <Card className="gap-0 rounded-xl border py-0 shadow-card">
          <div className="border-b p-4"><Skeleton className="h-4 w-24" /></div>
          <div className="space-y-4 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i}>
                <Skeleton className="mb-2 h-3 w-40" />
                <Skeleton className="h-[7px] w-full rounded-pill" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-3 gap-0 rounded-xl border py-0 shadow-card">
        <div className="border-b p-4"><Skeleton className="h-4 w-32" /></div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b p-4 last:border-b-0">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </Card>
    </div>
  );
}
