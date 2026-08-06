import { Inbox } from "lucide-react";

export function TableEmptyState({ title, description, action }: {
  title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="grid size-11 place-items-center rounded-xl bg-muted">
        <Inbox className="size-5 text-muted-foreground" />
      </div>
      <h3 className="mt-3.5 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DataTableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-10 border-b border-divider bg-muted/60" />
      {Array.from({ length: rows }).map((_, r) => (
        // 44px matches the real row height, so nothing shifts when data lands.
        <div key={r} className="flex h-11 items-center gap-4 border-b border-divider px-4 last:border-b-0">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="h-3 flex-1 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}
