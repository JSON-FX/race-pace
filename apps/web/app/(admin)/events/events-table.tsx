"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DataTable, type FilterDef } from "@/components/data-table";
import { EventStatusBadge } from "@/components/StatusBadge";
import type { AdminEventRow } from "@/lib/queries/events";
import type { SortState } from "@/lib/table-params";

// Mirrors the Postgres `event_status` enum (draft, open, almost_full,
// closed, completed, cancelled — see supabase/migrations) and the labels
// EventStatusBadge already uses. "published" is NOT a valid enum value and
// sending it 500s the query (22P02: invalid input value for enum).
const STATUS_FILTER: FilterDef = {
  key: "status",
  label: "Status",
  options: [
    { value: "draft", label: "Draft" },
    { value: "open", label: "Open" },
    { value: "almost_full", label: "Almost full" },
    { value: "closed", label: "Closed" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export function EventsTable({ rows, total, page, per, sort, activeFilters, q }: {
  rows: AdminEventRow[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
}) {
  const columns = useMemo<ColumnDef<AdminEventRow, unknown>[]>(() => [
    {
      accessorKey: "name",
      header: "Event",
      cell: ({ row }) => (
        <div>
          <div className="font-semibold">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">
            {[row.original.place, row.original.city_name, row.original.province_name].filter(Boolean).join(", ") || "—"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "event_date",
      header: "Date",
      cell: ({ row }) => <span className="font-mono tabular text-muted-foreground">{fmtDate(row.original.event_date)}</span>,
    },
    {
      id: "slots",
      header: "Slots",
      enableSorting: false,
      cell: ({ row }) => {
        const taken = row.original.categories.reduce((n, c) => n + c.slots_taken, 0);
        const totalSlots = row.original.categories.reduce((n, c) => n + c.slots_total, 0);
        return <span className="font-mono tabular">{taken} / {totalSlots}</span>;
      },
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <EventStatusBadge status={row.original.status} /> },
  ], []);

  return (
    <DataTable
      columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
      filterDefs={[STATUS_FILTER]} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search events…"
      rowHref={(r) => `/events/${r.id}/edit`}
      emptyState={{
        title: q || activeFilters.status ? "No events match" : "No events yet",
        description: q || activeFilters.status
          ? "Try a different search or clear your filters."
          : "Create your first event to start taking registrations.",
        action: <Button asChild size="sm"><Link href="/events/new">Create an event</Link></Button>,
      }}
    />
  );
}
