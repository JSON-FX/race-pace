"use client";

import { useMemo, useState } from "react";
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

export type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  total: number;
  page: number;
  per: number;
  sort: SortState[];
  filterDefs: FilterDef[];
  activeFilters: Record<string, string>;
  q?: string;
  searchPlaceholder?: string;
  bulkActions?: BulkAction[];
  getRowId?: (row: TData) => string;
  rowHref?: (row: TData) => string;
  emptyState?: { title: string; description: string; action?: React.ReactNode };
  isError?: boolean;
};

export function DataTable<TData>({
  columns, data, total, page, per, sort, filterDefs, activeFilters,
  q = "", searchPlaceholder = "Search…", bulkActions = [],
  getRowId, rowHref, emptyState, isError,
}: DataTableProps<TData>) {
  const params = useTableParams();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [visibility, setVisibility] = useState<VisibilityState>({});

  const selectable = bulkActions.length > 0 && !!getRowId;

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

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);

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
        onClearAll={params.clearFilters} />

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
                  <TableRow key={row.id} className={cn(rowHref && "cursor-pointer")}>
                    {row.getVisibleCells().map((cell) => {
                      const body = flexRender(cell.column.columnDef.cell, cell.getContext());
                      return (
                        <TableCell key={cell.id} className="py-3 text-[13px]">
                          {/* Link wraps the cell, not the row: an <a> cannot
                              legally contain <td>, and this keeps the row
                              keyboard-navigable and middle-clickable. */}
                          {rowHref && cell.column.id !== "__select" ? (
                            <Link href={rowHref(row.original)} className="block">{body}</Link>
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
