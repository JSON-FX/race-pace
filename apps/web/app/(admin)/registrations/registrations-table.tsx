"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Mail, Hash, CheckCircle2, XCircle } from "lucide-react";
import { DataTable, type FilterDef, type BulkAction } from "@/components/data-table";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import { RegistrationDetail } from "@/components/RegistrationDetail";
import { RunnerAvatar } from "@/components/RunnerAvatar";
import { BulkCancelDialog } from "@/components/BulkCancelDialog";
import { peso, fmtDateTime } from "@/lib/format";
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
  const searchParams = useSearchParams();
  const urlRegId = searchParams.get("reg");

  // The URL stays the source of truth — `?reg=<id>` is what makes a
  // registration linkable, and a cold load of that URL still resolves
  // server-side. But the modal must not WAIT for it: RegistrationDetail renders
  // entirely from a row already in `rows`, so the ~3.3s round trip bought
  // literally nothing.
  //
  // A tri-state override, not a plain `string | null`: closing has to be
  // expressible as "override to nothing" and distinguished from "no override",
  // or Close would leave the modal up until the URL caught up — the exact
  // latency being removed, just in the other direction.
  const [override, setOverride] = useState<{ id: string | null } | null>(null);

  // Drop the override once the URL agrees — and, just as importantly, when it
  // DISAGREES: a Back button press moves `urlRegId` without going through
  // openReg/closeReg, and a stale override would pin the modal open against it.
  useEffect(() => { setOverride(null); }, [urlRegId]);

  const selectedId = override ? override.id : urlRegId;
  const selected = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;

  /** Write `?reg=` without a server navigation.
   *
   *  `router.push` (and therefore useTableParams' `patch`) always re-runs the
   *  server component — for a modal rendered entirely from a row already on the
   *  client, that is a full round trip and a progress bar for zero new data.
   *  Next syncs pushState with useSearchParams, so the URL stays real,
   *  linkable and Back-able while nothing re-renders.
   *
   *  pushState, not replaceState: Back should close the modal, which is what
   *  people expect from something that opened over the page. The cost is one
   *  history entry per open, which is the right trade. */
  const writeRegParam = useCallback((id: string | null) => {
    const sp = new URLSearchParams(window.location.search);
    if (id) sp.set("reg", id);
    else sp.delete("reg");
    const qs = sp.toString();
    window.history.pushState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);

  const openReg = useCallback((id: string) => {
    setOverride({ id });
    writeRegParam(id);
  }, [writeRegParam]);

  const closeReg = useCallback(() => {
    setOverride({ id: null });
    writeRegParam(null);
  }, [writeRegParam]);

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
          onClick={() => openReg(row.original.id)}
          aria-label={`View ${row.original.full_name ?? "registration"}`}
          className="text-left hover:underline"
        >
          <RunnerAvatar
            id={row.original.id}
            name={row.original.full_name}
            email={row.original.email}
            avatarUrl={row.original.avatar_url}
          />
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
      cell: ({ row }) => <PaymentStatusBadge status={row.original.payment_status} />,
    },
    {
      id: "__chevron",
      header: () => null,
      enableSorting: false,
      cell: () => <span aria-hidden="true" className="text-[12px] text-muted-foreground">›</span>,
    },
  // `writeRegParam` is useCallback'd with an empty dependency array — it
  // reads `window.location` fresh on every call rather than closing over a
  // React value, so it can never go stale — and `openReg` is itself
  // useCallback-wrapped over that already-stable `writeRegParam`. Both are
  // referentially stable for the component's whole lifetime, so depending on
  // `openReg` here keeps the Runner cell's onClick correct (always today's
  // `openReg`, never a stale one) AND lets this memo genuinely memoize
  // instead of recomputing every render.
  ], [openReg]);

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
          onClose={closeReg}
          onRefunded={closeReg}
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
