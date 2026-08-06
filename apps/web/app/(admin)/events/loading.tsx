import { DataTableSkeleton } from "@/components/data-table";

export default function Loading() {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 h-9 w-40 animate-pulse rounded bg-muted" />
      <DataTableSkeleton rows={8} columns={4} />
    </div>
  );
}
