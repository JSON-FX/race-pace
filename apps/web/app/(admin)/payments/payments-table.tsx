"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type FilterDef } from "@/components/data-table";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import { MethodBadge, methodFilterOptions } from "@/components/MethodBadge";
import { peso, fmtDate } from "@/lib/format";
import type { PaymentRow } from "@/lib/queries/payments";
import type { SortState } from "@/lib/table-params";

// Mirrors the Postgres `payment_status` enum (pending, paid, failed,
// refunded — see supabase/migrations/20260718182546_init_orgs_profiles.sql).
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

export function PaymentsTable({ rows, total, page, per, sort, activeFilters, q, methods }: {
  rows: PaymentRow[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
  /** Every distinct `payments.method` this org has, from
   *  `listOrgPaymentMethods` — see its doc comment for why the Method filter's
   *  options are read out of the data instead of hardcoded here. */
  methods: string[];
}) {
  // Only offer the Method filter once there is something to filter BY. An org
  // whose payments are all still pending has no methods at all, and a filter
  // whose only entry is "All" is a control that can't do anything.
  const filters = useMemo<FilterDef[]>(() => {
    const options = methodFilterOptions(methods);
    return options.length ? [STATUS_FILTER, { key: "method", label: "Method", options }] : [STATUS_FILTER];
  }, [methods]);

  const columns = useMemo<ColumnDef<PaymentRow, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Runner",
      cell: ({ row }) => (
        <div>
          <div className="font-semibold">{row.original.full_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{row.original.event_name ?? "—"}</div>
        </div>
      ),
    },
    // Second, directly after the runner — the position the money-flow spec
    // gives it (docs/superpowers/specs/2026-08-06-commission-payouts-money-
    // flow.html, "Payments — the method column"). It reads as part of "who
    // paid and how", before the figures start.
    {
      accessorKey: "method",
      header: "Method",
      cell: ({ row }) => <MethodBadge method={row.original.method} />,
    },
    {
      accessorKey: "amount",
      header: "Gross",
      cell: ({ row }) => <span className="tabular">{peso(row.original.amount)}</span>,
    },
    {
      accessorKey: "platform_fee",
      header: "Fee",
      cell: ({ row }) => <span className="tabular text-muted-foreground">{peso(row.original.platform_fee)}</span>,
    },
    {
      accessorKey: "net_to_org",
      header: "Net",
      cell: ({ row }) => <span className="tabular font-semibold">{peso(row.original.net_to_org)}</span>,
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <PaymentStatusBadge status={row.original.status} /> },
    {
      accessorKey: "created_at",
      header: "Date",
      cell: ({ row }) => <span className="tabular text-muted-foreground">{fmtDate(row.original.created_at)}</span>,
    },
  ], []);

  return (
    <DataTable
      columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
      filterDefs={filters} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search runner or event…"
      emptyState={{
        title: "No payments match",
        description: "Try a different search or clear your filters.",
      }}
    />
  );
}
