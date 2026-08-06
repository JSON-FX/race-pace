"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PER_PAGE_OPTIONS, rangeLabel } from "@/lib/table-params";

/** Page numbers to render, with `null` marking an ellipsis gap.
 *  Always shows first, last, current, and one neighbour either side. */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pageCount - 1) out.push(null);
  out.push(pageCount);
  return out;
}

export function DataTablePagination({
  page, per, total, onPageChange, onPerChange,
}: {
  page: number; per: number; total: number;
  onPageChange: (page: number) => void;
  onPerChange: (per: number) => void;
}) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / per));

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3">
      <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
        <span>Rows per page</span>
        <Select value={String(per)} onValueChange={(v) => onPerChange(Number(v))}>
          <SelectTrigger aria-label="Rows per page" className="h-8 w-[72px] rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PER_PAGE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span aria-hidden>·</span>
        <span className="font-mono tabular">{rangeLabel(page, per, total)}</span>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="First page"
          disabled={page <= 1} onClick={() => onPageChange(1)}>
          <ChevronsLeft className="size-4" />
        </Button>
        <Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="Previous page"
          disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        {pageWindow(page, pageCount).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="px-1 text-sm text-muted-foreground" aria-hidden>…</span>
          ) : (
            <Button key={n} size="icon" aria-label={`Page ${n}`} aria-current={n === page ? "page" : undefined}
              variant={n === page ? "default" : "outline"} className="size-8 rounded-lg font-mono tabular"
              onClick={() => onPageChange(n)}>
              {n}
            </Button>
          ),
        )}
        <Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="Next page"
          disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="Last page"
          disabled={page >= pageCount} onClick={() => onPageChange(pageCount)}>
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
