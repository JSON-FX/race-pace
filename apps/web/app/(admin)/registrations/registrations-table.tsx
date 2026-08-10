"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Mail, Hash, CheckCircle2, XCircle } from "lucide-react";
import { DataTable, type FilterDef, type BulkAction } from "@/components/data-table";
import { PaymentStatusBadge, RegistrationStatusBadge } from "@/components/StatusBadge";
import { RegistrationDetail } from "@/components/RegistrationDetail";
import { RunnerAvatar } from "@/components/RunnerAvatar";
import { BulkCancelDialog } from "@/components/BulkCancelDialog";
import { peso, fmtDateTime } from "@/lib/format";
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
    // Routed to the registration_status column, not payment_status — see
    // listEventRegistrations in lib/queries/registrations.ts. Neither value
    // can ever appear on payment_status (that enum has no such members), so
    // these two MUST stay routed there or picking them throws a Postgres
    // enum-cast error instead of filtering anything.
    { value: "expired", label: "Expired" },
    { value: "cancelled", label: "Cancelled" },
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

  // Ids the admin has confirmed for a bulk cancel — null when the dialog is
  // closed. Kept separate from DataTable's own selection state (which is
  // internal to it) because the confirm step needs to survive the
  // in-between render where the AlertDialog is open.
  const [cancelIds, setCancelIds] = useState<string[] | null>(null);

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
          aria-label={`View ${row.original.full_name ?? "registration"}`}
          className="text-left hover:underline"
        >
          <RunnerAvatar id={row.original.id} name={row.original.full_name} email={row.original.email} />
        </button>
      ),
    },
    { accessorKey: "category_label", header: "Category", cell: ({ row }) => row.original.category_label ?? "—" },
    {
      accessorKey: "bib_name",
      header: "Bib",
      cell: ({ row }) => (
        row.original.bib_name
          ? <span className="tabular">{row.original.bib_name}</span>
          : <span className="text-muted-foreground">—</span>
      ),
    },
    {
      accessorKey: "created_at",
      header: "Registered",
      cell: ({ row }) => (
        <span className="tabular text-muted-foreground">{fmtDateTime(row.original.created_at)}</span>
      ),
    },
    {
      accessorKey: "total_amount",
      header: "Amount",
      cell: ({ row }) => <span className="tabular">{peso(row.original.total_amount)}</span>,
    },
    {
      accessorKey: "payment_status",
      header: "Status",
      // registration_status wins ONLY for 'expired'/'cancelled' — the two
      // terminal states payment_status can never represent (it has no such
      // enum values; a 'failed'/null payment_status is otherwise ambiguous
      // between "hold expired", "card declined", and "never started
      // checkout"). Every other state (paid/pending/refunded) keeps showing
      // payment_status exactly as before — it's the more precise signal for
      // those, and the two columns agree there anyway.
      cell: ({ row }) => {
        const regStatus = row.original.registration_status;
        if (regStatus === "expired" || regStatus === "cancelled") {
          return <RegistrationStatusBadge status={regStatus} />;
        }
        return <PaymentStatusBadge status={row.original.payment_status} />;
      },
    },
    {
      id: "__chevron",
      header: () => null,
      enableSorting: false,
      cell: () => <span aria-hidden="true" className="text-[12px] text-muted-foreground">›</span>,
    },
  // `setFilter` is stable across renders (see use-table-params.ts — every
  // setter is wrapped in useCallback), so depending on it here both keeps
  // the Runner cell's onClick correct (it always calls the current
  // setFilter, never a stale closure over an old `searchParams`) AND lets
  // this memo genuinely memoize instead of recomputing every render.
  ], [setFilter]);

  const bulkActions: BulkAction[] = useMemo(() => [
    {
      label: "Send email",
      icon: Mail,
      disabled: true,
      disabledReason: "Bulk email sending isn't wired up yet — no sender exists on the backend.",
      onSelect: () => {},
    },
    {
      label: "Assign bibs",
      icon: Hash,
      disabled: true,
      disabledReason: "There's no bib-assignment RPC yet — this would be a no-op if it ran.",
      onSelect: () => {},
    },
    {
      label: "Mark checked-in",
      icon: CheckCircle2,
      disabled: true,
      disabledReason: "Check-in ships in PR2, alongside the race-day roster.",
      onSelect: () => {},
    },
    {
      label: "Cancel",
      icon: XCircle,
      variant: "destructive",
      onSelect: (ids) => setCancelIds(ids),
    },
  ], []);

  return (
    <>
      <DataTable
        columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
        filterDefs={filterDefs} activeFilters={activeFilters} q={q}
        searchPlaceholder="Search name, email, bib…"
        bulkActions={bulkActions}
        getRowId={(row) => row.id}
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

      {cancelIds ? (
        <BulkCancelDialog
          ids={cancelIds}
          onDone={() => setCancelIds(null)}
          onClose={() => setCancelIds(null)}
        />
      ) : null}
    </>
  );
}
