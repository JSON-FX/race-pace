"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type FilterDef } from "@/components/data-table";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import { RegistrationDetail } from "@/components/RegistrationDetail";
import { peso, fmtDate } from "@/lib/format";
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
  // The row detail sheet is client-local state, not URL state — the sheet
  // shows data already present in `rows`, so there's nothing to deep-link to
  // that a fresh server fetch would add.
  const [selected, setSelected] = useState<RegistrationRow | null>(null);

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
          onClick={() => setSelected(row.original)}
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
  ], []);

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
          onClose={() => setSelected(null)}
          onRefunded={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
