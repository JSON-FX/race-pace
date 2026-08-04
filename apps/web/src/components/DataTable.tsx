import { useState } from "react";
import {
  flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortState = { id: string; desc: boolean };

export type ServerPaging = {
  pageIndex: number;
  pageCount: number;
  totalRows: number;
  onPageChange: (pageIndex: number) => void;
  sorting: SortState[];
  onSortingChange: (s: SortState[]) => void;
};

type Props<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  messages: { loading: string; empty: string; error: string };
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onRowClick?: (row: TData) => void;
  server?: ServerPaging;
  pageSize?: number;
};

export function DataTable<TData>({
  columns, data, messages, isLoading, isError, onRetry, onRowClick, server, pageSize = 25,
}: Props<TData>) {
  const [clientSorting, setClientSorting] = useState<SortingState>([]);
  const sorting: SortingState = server ? server.sorting : clientSorting;

  const table = useReactTable({
    data,
    columns,
    state: server
      ? { sorting, pagination: { pageIndex: server.pageIndex, pageSize } }
      : { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (server) server.onSortingChange(next as SortState[]);
      else setClientSorting(next);
    },
    manualPagination: !!server,
    manualSorting: !!server,
    pageCount: server?.pageCount,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: server ? undefined : getSortedRowModel(),
    getPaginationRowModel: server ? undefined : getPaginationRowModel(),
    initialState: server ? undefined : { pagination: { pageIndex: 0, pageSize } },
  });

  const pageIndex = server ? server.pageIndex : table.getState().pagination.pageIndex;
  const pageCount = server ? server.pageCount : table.getPageCount();
  const totalRows = server ? server.totalRows : data.length;
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;

  function goTo(next: number) {
    if (server) server.onPageChange(next);
    else table.setPageIndex(next);
  }

  const colSpan = columns.length;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader className="bg-muted/60">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" />
                          : dir === "desc" ? <ArrowDown className="size-3" />
                          : <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="p-5 text-sm text-muted-foreground">{messages.loading}</TableCell>
            </TableRow>
          ) : isError ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="p-5">
                <div className="flex items-center gap-3.5">
                  <span className="text-sm text-muted-foreground">{messages.error}</span>
                  {onRetry ? <Button variant="outline" size="sm" className="rounded-pill" onClick={onRetry}>Retry</Button> : null}
                </div>
              </TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="p-5 text-sm text-muted-foreground">{messages.empty}</TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(onRowClick && "cursor-pointer")}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-3.5 text-[13px]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {!isLoading && !isError && totalRows > 0 ? (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] text-muted-foreground">
          <span>{totalRows} rows</span>
          <div className="flex items-center gap-3">
            <span>Page {pageIndex + 1} of {Math.max(pageCount, 1)}</span>
            <Button variant="outline" size="sm" aria-label="Previous page" disabled={!canPrev} onClick={() => goTo(pageIndex - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" aria-label="Next page" disabled={!canNext} onClick={() => goTo(pageIndex + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
