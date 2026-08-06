"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type FilterDef } from "@/components/data-table";
import { PaymentStatusBadge } from "@/components/StatusBadge";
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

// `payments.method` is a plain `text` column (supabase/migrations/
// 20260718183018_registrations_payments.sql:40), NOT an enum — nothing in
// the schema constrains it, so these options are derived from the code that
// actually writes the column, not guessed:
//   - supabase/functions/_shared/payments.ts:41 — the checkout is only ever
//     opened with paymentMethodTypes ["card", "gcash", "paymaya"], so those
//     are the only methods a runner can actually pay with.
//   - supabase/functions/payments-webhook/index.ts:28 — the normal
//     confirmation path stores PayMongo's own `source.type` for the
//     payment, which for this checkout is one of "card" | "gcash" |
//     "paymaya" (falling back to the literal "paymongo" if PayMongo ever
//     omits it).
//   - supabase/functions/payment-verify/index.ts:52 (the "Check again" /
//     return-from-checkout fallback path, used when the webhook hasn't
//     landed yet) calls confirmPayment(id, "paymongo", ...) with a
//     hardcoded literal — so some real rows can legitimately read
//     method = "paymongo" even though the runner paid via GCash or a card.
//     "paymongo" is NOT redundant with the other three options: it is the
//     one method value this fallback path can produce regardless of which
//     PayMongo method the runner actually used, so dropping it would
//     silently exclude real rows again.
// Confirmed against real data: local Supabase has exactly one payments row,
// method = "gcash" (`select method, status, count(*) from payments group by
// 1,2` via `docker exec supabase_db_race-pace psql`).
// One thing this list can NOT claim to be: a closed set. The webhook path
// stores PayMongo's own `source.type` verbatim (payments-webhook/index.ts:
// 28), which is an external API value this repo does not control and can't
// fully enumerate. This option list is "every value our own code writes",
// not "every value PayMongo could ever send" — if an unexpected method
// string shows up in `admin_payments_v` in production, re-check PayMongo's
// source-type docs before assuming it's a bug here.
const METHOD_FILTER: FilterDef = {
  key: "method",
  label: "Method",
  options: [
    { value: "gcash", label: "GCash" },
    { value: "card", label: "Card" },
    { value: "paymaya", label: "Maya" },
    { value: "paymongo", label: "PayMongo (other)" },
  ],
};

const FILTERS: FilterDef[] = [STATUS_FILTER, METHOD_FILTER];

const METHOD_LABEL: Record<string, string> = {
  gcash: "GCash",
  card: "Card",
  paymaya: "Maya",
  paymongo: "PayMongo",
};

export function PaymentsTable({ rows, total, page, per, sort, activeFilters, q }: {
  rows: PaymentRow[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
}) {
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
    {
      accessorKey: "method",
      header: "Method",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.method ? (METHOD_LABEL[row.original.method] ?? row.original.method) : "—"}
        </span>
      ),
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
      filterDefs={FILTERS} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search runner or event…"
      emptyState={{
        title: "No payments match",
        description: "Try a different search or clear your filters.",
      }}
    />
  );
}
