"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  flexRender, getCoreRowModel, useReactTable,
  type ColumnDef, type VisibilityState,
} from "@tanstack/react-table";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useTableParams } from "@/lib/use-table-params";
import type { SortState } from "@/lib/table-params";
import { DataTableToolbar } from "./toolbar";
import { ActiveFilters } from "./active-filters";
import { BulkBar, type BulkAction } from "./bulk-bar";
import { DataTablePagination } from "./pagination";
import { SortableHeader } from "./column-header";
import { TableEmptyState } from "./empty-state";
import type { FilterDef } from "./faceted-filter";
import { cn } from "@/lib/utils";

/** `bulkActions` needs a stable id per row to report back on `onSelect`, and
 *  a selection checkbox column with nothing to key off is a bug, not a
 *  feature — so the two are required together, or omitted together. A
 *  caller cannot typecheck with one but not the other. */
type DataTableSelectionProps<TData> =
  | { bulkActions: BulkAction[]; getRowId: (row: TData) => string }
  | { bulkActions?: undefined; getRowId?: undefined };

export type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  total: number;
  page: number;
  per: number;
  sort: SortState[];
  filterDefs: FilterDef[];
  activeFilters: Record<string, string>;
  /** Required, not just defaulted: it's load-bearing state. Omitting it by
   *  accident used to render an empty toolbar and no chip while the server
   *  kept filtering by whatever `?q=` was already in the URL — silently
   *  showing the admin a filtered list with no visible cause. */
  q: string;
  searchPlaceholder?: string;
  rowHref?: (row: TData) => string;
  /** Query-param keys "Clear all" must NOT remove, beyond the `sort`/`per`
   *  it already preserves — e.g. Registrations passes `["event"]` so
   *  clearing filters can't navigate the admin off the event they're
   *  scoped to. Forwarded verbatim to `useTableParams().clearFilters`. */
  preserveOnClear?: string[];
  emptyState?: { title: string; description: string; action?: React.ReactNode };
  isError?: boolean;
} & DataTableSelectionProps<TData>;

export function DataTable<TData>({
  columns, data, total, page, per, sort, filterDefs, activeFilters, q,
  searchPlaceholder = "Search…", bulkActions = [], preserveOnClear,
  getRowId, rowHref, emptyState, isError,
}: DataTableProps<TData>) {
  const params = useTableParams();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [visibility, setVisibility] = useState<VisibilityState>({});

  const selectable = bulkActions.length > 0 && !!getRowId;

  // The fix for stale selection surviving a page/filter/search change: drop
  // it the moment any of those change. (See the intersection below for the
  // seatbelt — this effect firing is not itself relied on for correctness.)
  const filtersKey = useMemo(() => JSON.stringify(activeFilters), [activeFilters]);
  useEffect(() => {
    setSelected({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, per, q, filtersKey]);

  const allColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!selectable) return columns;
    return [
      {
        id: "__select",
        enableSorting: false,
        size: 38,
        header: () => null,
        cell: ({ row }) => {
          const id = getRowId!(row.original);
          return (
            <Checkbox aria-label="Select row" checked={!!selected[id]}
              onCheckedChange={(v) => setSelected((s) => ({ ...s, [id]: !!v }))} />
          );
        },
      },
      ...columns,
    ];
  }, [columns, selectable, getRowId, selected]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting: sort, columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    manualSorting: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  // The seatbelt: even if the reset effect above hasn't flushed yet (or ran
  // for a reason that isn't page/per/q/filters — e.g. the caller mutated
  // `data` in place after a refund), a selected id that isn't in the
  // *current* `data` never reaches an action handler.
  const currentIds = useMemo(
    () => new Set(getRowId ? data.map(getRowId) : []),
    [data, getRowId],
  );
  const selectedIds = Object.keys(selected).filter((k) => selected[k] && currentIds.has(k));

  const firstDataColumnId = useMemo(
    () => table.getVisibleFlatColumns().find((c) => c.id !== "__select")?.id,
    [table],
  );

  const columnToggles = table
    .getAllColumns()
    .filter((c) => c.id !== "__select" && c.getCanHide())
    .map((c) => ({
      id: c.id,
      label: typeof c.columnDef.header === "string" ? c.columnDef.header : c.id,
      visible: c.getIsVisible(),
      toggle: () => c.toggleVisibility(),
    }));

  return (
    <div className="space-y-3">
      <DataTableToolbar
        filterDefs={filterDefs} activeFilters={activeFilters} q={q}
        searchPlaceholder={searchPlaceholder} columnToggles={columnToggles}
        onFilterChange={params.setFilter} onSearchChange={params.setQ}
      />

      <ActiveFilters defs={filterDefs} active={activeFilters} q={q}
        onRemove={(key) => (key === "q" ? params.setQ("") : params.setFilter(key, "all"))}
        onClearAll={() => params.clearFilters(preserveOnClear)} />

      {/* Announced after every filter change so screen-reader users learn the
          result count without hunting for it. */}
      <p role="status" aria-live="polite" className="sr-only">{total} results</p>

      <div className={cn("overflow-hidden rounded-xl border border-border bg-card", params.isPending && "opacity-60 transition-opacity")}>
        {selectable ? (
          <BulkBar count={selectedIds.length} ids={selectedIds} actions={bulkActions} onClear={() => setSelected({})} />
        ) : null}

        {isError ? (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertCircle className="size-4" />
            <AlertDescription>Couldn&apos;t load this data. Reload the page to try again.</AlertDescription>
          </Alert>
        ) : data.length === 0 ? (
          <TableEmptyState
            title={emptyState?.title ?? "Nothing here yet"}
            description={emptyState?.description ?? "Try clearing your filters."}
            action={emptyState?.action}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/60">
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => (
                      <SortableHeader key={header.id} header={header}
                        onSort={(id, desc) => params.setSort([{ id, desc }])} />
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(rowHref && "cursor-pointer")}
                    onClick={
                      rowHref
                        ? (e) => {
                            // Only the first data cell renders a real <a> (see
                            // below) — clicking anywhere else in the row
                            // delegates to it, so the row acts clickable
                            // without turning every cell into its own link.
                            // Clicks that already landed on an interactive
                            // element (the link itself, the select checkbox,
                            // a future row action) are left alone so we don't
                            // double-navigate or eat their own click.
                            const target = e.target as HTMLElement;
                            if (target.closest("a,button,input,[role='checkbox']")) return;
                            (e.currentTarget.querySelector("a") as HTMLAnchorElement | null)?.click();
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => {
                      const body = flexRender(cell.column.columnDef.cell, cell.getContext());
                      const isPrimaryLink = !!rowHref && cell.column.id === firstDataColumnId;
                      return (
                        <TableCell key={cell.id} className="py-3 text-[13px]">
                          {/* Exactly one real <a> per row, in the first data
                              cell — not one per cell. An <a> cannot legally
                              contain a <td>, so it wraps the cell instead of
                              the row; the row's onClick above (and this
                              being a real link) is what keeps the rest of
                              the row clickable, keyboard-reachable and
                              middle-clickable without turning a 6-column
                              table into 150 tab stops for 25 destinations. */}
                          {isPrimaryLink ? (
                            <Link href={rowHref!(row.original)} className="block">{body}</Link>
                          ) : body}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isError ? (
          <DataTablePagination page={page} per={per} total={total}
            onPageChange={params.setPage} onPerChange={params.setPer} />
        ) : null}
      </div>
    </div>
  );
}
