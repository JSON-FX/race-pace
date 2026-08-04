import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { useTableParams } from "@/lib/useTableParams";
import { useMyRoles } from "../lib/roles";
import { useOrgEvents, useEventForEditor } from "../lib/events";
import {
  useEventRegistrations, useEventRegistrationCounts, PAGE_SIZE,
  type RegistrationRow, type PaymentStatus,
} from "../lib/registrations";
import { RegistrationDetail } from "../components/RegistrationDetail";
import { PaymentStatusBadge } from "../components/StatusBadge";

const PAY_FILTERS = ["all", "pending", "paid", "refunded", "failed"] as const;
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Registrations() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const events = useOrgEvents(orgId);
  const counts = useEventRegistrationCounts(orgId);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event") ?? events.data?.[0]?.id ?? undefined;

  const t = useTableParams({ sort: [{ id: "created_at", desc: true }] });
  const status = (t.filters.status ?? "all") as PaymentStatus | "all";
  const categoryId = t.filters.category ?? "all";
  const selectedId = t.filters.reg ?? null;

  const editor = useEventForEditor(eventId);
  const regs = useEventRegistrations(eventId, { page: t.page, sort: t.sort, status, categoryId, q: t.q });

  // Category ids are per-event, so a stale category filter would silently return
  // zero rows after switching events. Clear it, and any open detail, on change —
  // but not on first mount, or a deep link like ?event=e1&category=c4 would have
  // its filters stripped before the first paint.
  const prevEventIdRef = useRef(eventId);
  useEffect(() => {
    if (prevEventIdRef.current === eventId) return;
    prevEventIdRef.current = eventId;
    t.setFilter("category", "all");
    t.setFilter("reg", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const [searchInput, setSearchInput] = useState(t.q);
  const setQRef = useRef(t.setQ);
  setQRef.current = t.setQ;
  const searchMountedRef = useRef(false);
  useEffect(() => {
    if (!searchMountedRef.current) { searchMountedRef.current = true; return; }
    const id = setTimeout(() => setQRef.current(searchInput), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const rows = regs.data?.rows ?? [];
  const total = regs.data?.total ?? 0;
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const columns = useMemo<ColumnDef<RegistrationRow, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Runner",
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-semibold">{row.original.full_name ?? "—"}</div>
          {row.original.bib_name ? <div className="text-xs text-muted-foreground">{row.original.bib_name}</div> : null}
        </div>
      ),
    },
    { accessorKey: "category_label", header: "Category", cell: ({ row }) => row.original.category_label ?? "—" },
    { accessorKey: "total_amount", header: "Amount", cell: ({ row }) => peso(row.original.total_amount) },
    { accessorKey: "payment_status", header: "Payment", cell: ({ row }) => <PaymentStatusBadge status={row.original.payment_status} /> },
    { accessorKey: "created_at", header: "Registered", cell: ({ row }) => fmtDate(row.original.created_at) },
  ], []);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={eventId ?? ""} onValueChange={(v) => setParams({ event: v })}>
          <SelectTrigger aria-label="Event" className="w-[260px]"><SelectValue placeholder="Pick an event" /></SelectTrigger>
          <SelectContent>
            {(events.data ?? []).map((ev) => (
              <SelectItem key={ev.id} value={ev.id}>
                {ev.name}{counts.data?.[ev.id] != null ? ` (${counts.data[ev.id]})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => t.setFilter("status", v)}>
          <SelectTrigger aria-label="Payment status" className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAY_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>{f === "all" ? "All payments" : f.charAt(0).toUpperCase() + f.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={categoryId} onValueChange={(v) => t.setFilter("category", v)}>
          <SelectTrigger aria-label="Category" className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(editor.data?.categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search name" placeholder="Search name…" className="w-[200px] pl-8"
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
      </div>

      {!eventId ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Pick an event to see its registrations.
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={regs.isLoading}
          isError={regs.isError}
          onRetry={() => regs.refetch()}
          messages={{ loading: "Loading registrations…", empty: "No registrations match.", error: "Couldn't load registrations." }}
          onRowClick={(r) => t.setFilter("reg", r.id)}
          server={{
            pageIndex: t.page - 1,
            pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
            totalRows: total,
            onPageChange: (i) => t.setPage(i + 1),
            sorting: t.sort,
            onSortingChange: t.setSort,
          }}
        />
      )}

      {selected ? (
        <RegistrationDetail
          row={selected}
          onClose={() => t.setFilter("reg", "all")}
          onRefunded={() => {
            t.setFilter("reg", "all");
            regs.refetch();
            counts.refetch();
            qc.invalidateQueries({ queryKey: ["org-events"] });
          }}
        />
      ) : null}
    </div>
  );
}
