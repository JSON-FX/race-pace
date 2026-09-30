import { KpiRowSkeleton } from "@/components/kpi-card";
import { DataTableSkeleton } from "@/components/data-table";
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return <div className="px-4 py-8 md:px-8" role="status" aria-label="Loading event reservations"><Skeleton className="mb-6 h-8 w-48" /><Skeleton className="mb-6 h-12 w-full max-w-[580px]" /><KpiRowSkeleton cards={4} /><DataTableSkeleton rows={6} columns={8} /></div>;
}
