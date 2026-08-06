"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type FilterDef } from "@/components/data-table";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import { RegistrationDetail } from "@/components/RegistrationDetail";
import { peso, fmtDate } from "@/lib/format";
import { useTableParams } from "@/lib/use-table-params";
import type { RegistrationRow } from "@/lib/queries/registrations";
import type { SortState } from "@/lib/table-params";

const STATUS_FILTER: FilterDef = {
  key: "status",
  label: "Status",
  options: [
    { value: "paid", label: "Paid" },
    { value: "pending", label: "Pending" },
    { value: "refunded", label: "Refunded" },
    { value: "failed", label: "Failed" },
  ],
};

export function RegistrationsTable({
  rows, total, page, per, sort, activeFilters, q, categories,
}: {
  rows: RegistrationRow[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
  categories: { id: string; label: string }[];
}) {
  // The detail sheet is driven by `?reg=<id>`, not local state, so an admin
  // can bookmark or paste a link to a specific registration (the old SPA
  // supported this). `reg` is a filter key like any other (parseTableParams
  // treats every non-reserved param that way) but deliberately has no
  // FilterDef — ActiveFilters only renders a chip for keys present in
  // filterDefs, so this never shows up as a removable chip, same as `event`
  // already doesn't. `listEventRegistrations` never reads `filters.reg`, so
  // it can't affect the query. And because `reg` isn't in
  // `preserveOnClear`, "Clear all" closes the sheet along with every other
  // non-`event` param.
  const { setFilter } = useTableParams();
  const selectedId = activeFilters.reg;
  const selected = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;

  const filterDefs = useMemo<FilterDef[]>(() => [
    STATUS_FILTER,
    { key: "category", label: "Category", options: categories.map((c) => ({ value: c.id, label: c.label })) },
  ], [categories]);

  const columns = useMemo<ColumnDef<RegistrationRow, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Runner",
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setFilter("reg", row.original.id)}
          className="text-left hover:underline"
        >
          <div className="font-semibold">{row.original.full_name ?? "—"}</div>
          {row.original.bib_name ? (
            <div className="text-xs text-muted-foreground">{row.original.bib_name}</div>
          ) : null}
        </button>
      ),
    },
    { accessorKey: "category_label", header: "Category", cell: ({ row }) => row.original.category_label ?? "—" },
    {
      accessorKey: "total_amount",
      header: "Amount",
      cell: ({ row }) => <span className="font-mono tabular">{peso(row.original.total_amount)}</span>,
    },
    {
      accessorKey: "payment_status",
      header: "Payment",
      cell: ({ row }) => <PaymentStatusBadge status={row.original.payment_status} />,
    },
    {
      accessorKey: "created_at",
      header: "Registered",
      cell: ({ row }) => (
        <span className="font-mono tabular text-muted-foreground">{fmtDate(row.original.created_at)}</span>
      ),
    },
  // `setFilter` is stable across renders (see use-table-params.ts — every
  // setter is wrapped in useCallback), so depending on it here both keeps
  // the Runner cell's onClick correct (it always calls the current
  // setFilter, never a stale closure over an old `searchParams`) AND lets
  // this memo genuinely memoize instead of recomputing every render.
  ], [setFilter]);

  return (
    <>
      <DataTable
        columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
        filterDefs={filterDefs} activeFilters={activeFilters} q={q}
        searchPlaceholder="Search name or bib…"
        // Registrations is scoped by ?event=<uuid>. "Clear all" wipes every
        // param except sort/per/this list — without "event" here, clicking
        // Clear all would silently move the admin to a different event.
        preserveOnClear={["event"]}
        emptyState={{
          title: "No registrations match",
          description: "Try a different search, or clear your filters to see everyone.",
        }}
      />

      {selected ? (
        <RegistrationDetail
          row={selected}
          // "all" is setFilter's own sentinel for "remove this key" — closes
          // the sheet by dropping `reg` from the URL, same as removing any
          // other filter chip.
          onClose={() => setFilter("reg", "all")}
          onRefunded={() => setFilter("reg", "all")}
        />
      ) : null}
    </>
  );
}
