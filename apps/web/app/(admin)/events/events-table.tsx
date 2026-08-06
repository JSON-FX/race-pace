"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, type FilterDef } from "@/components/data-table";
import { EventStatusBadge } from "@/components/StatusBadge";
import { CancelModal } from "@/components/CancelModal";
import { RescheduleModal } from "@/components/RescheduleModal";
import type { AdminEventRow } from "@/lib/queries/events";
import type { SortState } from "@/lib/table-params";
import { fmtDate as fmtDateBase } from "@/lib/format";

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

// Thin null-guard over lib/format's fmtDate — that helper takes a non-null
// `string` (every OTHER caller has a guaranteed date), but `event_date` on
// this table is nullable. Never hand-roll the actual formatting here.
const fmtDate = (d: string | null) => (d ? fmtDateBase(d) : "—");

export function EventsTable({ rows, total, page, per, sort, activeFilters, q, canWrite, isError }: {
  rows: AdminEventRow[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
  /** Mirrors `assertCanWriteEvent` in lib/actions/events.ts — the SAME
   *  boundary the Reschedule/Cancel Server Actions re-check themselves. This
   *  is not the authorization; it just keeps the menu from being offered to
   *  someone whose click would only bounce off the server with "You don't
   *  have permission to edit this event." Passed down from EventsPage
   *  (`!!roles?.isAdmin`), never derived client-side. */
  canWrite: boolean;
  /** Set when EventsPage's `listOrgEvents` call threw — see that page's
   *  comment for why the query is caught there instead of left to
   *  app/(admin)/error.tsx: everything else on this page (header, count,
   *  "New event") stays usable, only the table area degrades. */
  isError?: boolean;
}) {
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<AdminEventRow | null>(null);

  const columns = useMemo<ColumnDef<AdminEventRow, unknown>[]>(() => {
    const base: ColumnDef<AdminEventRow, unknown>[] = [
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
    ];

    if (!canWrite) return base;

    // Trailing, not leading — DataTable makes the FIRST visible data column
    // the row's `<a>` (see data-table.tsx); an actions column ahead of
    // "Event" would either become that link or render a second `<a>` in the
    // same row, both of which DataTable's contract forbids. Appending here
    // keeps "name" as the sole primary link.
    base.push({
      id: "actions",
      header: () => null,
      enableSorting: false,
      size: 48,
      cell: ({ row }) => (
        // stopPropagation matters here for a reason DataTable's own row
        // handler can't cover on its own: DropdownMenuContent renders into a
        // React Portal (real DOM parent is <body>), but React still bubbles
        // its click through the *React* tree — i.e. through this div — not
        // the DOM tree. DataTable's row onClick guards against clicks that
        // landed on `a,button,input,[role='checkbox']` by walking the DOM
        // via `closest()`, which can't see the portal's real DOM ancestors;
        // without this stopPropagation, selecting "Cancel event" from the
        // menu would also fire the row's fallback `querySelector("a")
        // .click()` and navigate to the edit page out from under the modal.
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${row.original.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/events/${row.original.id}/edit`}>Edit</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRescheduleTarget(row.original)}>
                Reschedule
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setCancelTarget({ id: row.original.id, name: row.original.name })}
              >
                Cancel event
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    });

    return base;
  }, [canWrite]);

  return (
    <>
      <DataTable
        columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
        filterDefs={[STATUS_FILTER]} activeFilters={activeFilters} q={q}
        searchPlaceholder="Search events…"
        rowHref={(r) => `/events/${r.id}/edit`}
        isError={isError}
        emptyState={{
          title: q || activeFilters.status ? "No events match" : "No events yet",
          description: q || activeFilters.status
            ? "Try a different search or clear your filters."
            : "Create your first event to start taking registrations.",
          action: <Button asChild size="sm"><Link href="/events/new">Create an event</Link></Button>,
        }}
      />

      {cancelTarget ? (
        <CancelModal
          event={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => setCancelTarget(null)}
        />
      ) : null}

      {rescheduleTarget ? (
        <RescheduleModal
          event={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onDone={() => setRescheduleTarget(null)}
        />
      ) : null}
    </>
  );
}
