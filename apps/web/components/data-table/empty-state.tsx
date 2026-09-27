import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";

export function TableEmptyState({ title, description, action }: {
  title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <Empty className="px-6 py-16">
      <EmptyHeader><EmptyMedia variant="icon"><Inbox aria-hidden /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>{action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function DataTableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <Card className="gap-0 overflow-hidden border py-0">
      <div className="h-10 border-b border-divider bg-muted/60" />
      {Array.from({ length: rows }).map((_, r) => (
        // 44px matches the real row height, so nothing shifts when data lands.
        <div key={r} className="flex h-11 items-center gap-4 border-b border-divider px-4 last:border-b-0">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </Card>
  );
}
