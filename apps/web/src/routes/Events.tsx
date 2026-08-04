import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { formatAddress, formatDateRange } from "@race-pace/shared";
import { useMyRoles } from "../lib/roles";
import { useOrgEvents, type AdminEventRow } from "../lib/events";
import { useEventRegistrationCounts } from "../lib/registrations";
import { RescheduleModal } from "../components/RescheduleModal";
import { CancelModal } from "../components/CancelModal";
import { EventStatusBadge } from "../components/StatusBadge";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function fill(cats: AdminEventRow["categories"]) {
  const taken = cats.reduce((s, c) => s + c.slots_taken, 0);
  const total = cats.reduce((s, c) => s + c.slots_total, 0);
  return `${taken}/${total}`;
}
function fmtDate(d: string | null) {
  return d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function Events() {
  const roles = useMyRoles();
  const { data, isLoading, isError, refetch } = useOrgEvents(roles.data?.orgId ?? undefined);
  const counts = useEventRegistrationCounts(roles.data?.orgId ?? undefined);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ kind: "reschedule" | "cancel"; ev: AdminEventRow } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["org-events"] });

  const columns = useMemo<ColumnDef<AdminEventRow, unknown>[]>(() => [
    {
      accessorKey: "name",
      header: "Event",
      cell: ({ row }) => {
        const e = row.original;
        const place = formatAddress({ city_name: e.city_name, province_name: e.province_name }) || e.place;
        return (
          <div>
            <div className="text-sm font-semibold">{e.name}</div>
            {place ? <div className="text-xs text-muted-foreground">{place}</div> : null}
          </div>
        );
      },
    },
    {
      accessorKey: "event_date",
      header: "Date",
      cell: ({ row }) => {
        const e = row.original;
        return (
          <span>
            {e.event_date ? formatDateRange(e.event_date, e.end_date, fmtDate) : "—"}
            {e.original_date ? <span className="text-xs text-info"> · was {fmtDate(e.original_date)}</span> : null}
          </span>
        );
      },
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <EventStatusBadge status={row.original.status} /> },
    { id: "categories", header: "Categories", cell: ({ row }) => row.original.categories.length },
    { id: "fill", header: "Fill", cell: ({ row }) => fill(row.original.categories) },
    { id: "regs", header: "Regs", cell: ({ row }) => counts.data?.[row.original.id] ?? 0 },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const e = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${e.name}`}>⋯</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => nav(`/events/${e.id}/edit`)}>Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => nav(`/registrations?event=${e.id}`)}>View registrations</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setModal({ kind: "reschedule", ev: e })}>Reschedule</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onSelect={() => setModal({ kind: "cancel", ev: e })}>
                Cancel event
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ], [counts.data, nav]);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-4 flex justify-end">
        <Button className="rounded-pill" onClick={() => nav("/events/new")}>+ Create event</Button>
      </div>
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        messages={{ loading: "Loading events…", empty: "No events yet.", error: "Couldn't load events." }}
      />
      {modal?.kind === "reschedule" ? <RescheduleModal event={modal.ev} onClose={() => setModal(null)} onDone={refresh} /> : null}
      {modal?.kind === "cancel" ? <CancelModal event={modal.ev} onClose={() => setModal(null)} onDone={refresh} /> : null}
    </div>
  );
}
