"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { Header } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import { TableHead } from "@/components/ui/table";
import { declaredColumnWidth } from "./column-size";

export function SortableHeader<TData>({ header, onSort }: {
  header: Header<TData, unknown>;
  onSort: (id: string, desc: boolean) => void;
}) {
  const canSort = header.column.getCanSort();
  const dir = header.column.getIsSorted();
  const content = header.isPlaceholder
    ? null
    : flexRender(header.column.columnDef.header, header.getContext());

  const width = declaredColumnWidth(header.column.columnDef.size);

  return (
    <TableHead
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : canSort ? "none" : undefined}
      style={width !== undefined ? { width } : undefined}
      className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {canSort ? (
        <button type="button" className="inline-flex items-center gap-1 uppercase"
          onClick={() => onSort(header.column.id, dir === "asc")}>
          {content}
          {dir === "asc" ? <ArrowUp className="size-3" />
            : dir === "desc" ? <ArrowDown className="size-3" />
            : <ChevronsUpDown className="size-3 opacity-40" />}
        </button>
      ) : content}
    </TableHead>
  );
}
