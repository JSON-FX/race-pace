import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Platform page: scope band, KPI row, then table(s). The band is drawn solid
 *  rather than skeletonised — it states WHOSE data this is, and a page that
 *  briefly can't answer that is worse than one that is briefly empty. */
export default function Loading() {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-[13px] flex items-center gap-3 rounded-xl bg-forest px-4 py-3">
        <Skeleton className="h-4 w-32 bg-white/15" />
        <Skeleton className="h-3 w-48 bg-white/10" />
      </div>

      <Skeleton className="mb-5 h-7 w-44" />

      <div className="mb-[18px] grid grid-cols-2 gap-3 min-[760px]:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="gap-0 rounded-xl border px-[15px] py-[14px] shadow-card">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-[9px] h-6 w-28" />
          </Card>
        ))}
      </div>

      <Card className="gap-0 rounded-xl border py-0 shadow-card">
        <div className="border-b bg-muted/40 p-3"><Skeleton className="h-3 w-full max-w-md" /></div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b p-4 last:border-b-0">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </Card>
    </div>
  );
}
