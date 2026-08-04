import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { useTableParams } from "@/lib/useTableParams";
import { useMyRoles } from "../lib/roles";
import { usePayments, PAGE_SIZE, type PaymentRow, type PaymentStatus } from "../lib/registrations";
import { PaymentStatusBadge } from "../components/StatusBadge";

const FILTERS = ["all", "pending", "paid", "refunded", "failed"] as const;
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Payments() {
  const roles = useMyRoles();
  const nav = useNavigate();
  const t = useTableParams({ sort: [{ id: "created_at", desc: true }] });
  const status = (t.filters.status ?? "all") as PaymentStatus | "all";
  const pays = usePayments(roles.data?.orgId ?? undefined, { page: t.page, sort: t.sort, status, q: t.q });

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

  const columns = useMemo<ColumnDef<PaymentRow, unknown>[]>(() => [
    { accessorKey: "event_name", header: "Event", cell: ({ row }) => <span className="font-semibold">{row.original.event_name ?? "—"}</span> },
    { accessorKey: "full_name", header: "Runner", cell: ({ row }) => row.original.full_name ?? "—" },
    { accessorKey: "amount", header: "Amount", cell: ({ row }) => peso(row.original.amount) },
    { accessorKey: "platform_fee", header: "Fee", cell: ({ row }) => peso(row.original.platform_fee) },
    { accessorKey: "net_to_org", header: "Net", cell: ({ row }) => peso(row.original.net_to_org) },
    { accessorKey: "method", header: "Method", cell: ({ row }) => row.original.method ?? "—" },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <PaymentStatusBadge status={row.original.status} /> },
    { accessorKey: "created_at", header: "Date", cell: ({ row }) => fmtDate(row.original.created_at) },
  ], []);

  const total = pays.data?.total ?? 0;

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={(v) => t.setFilter("status", v)}>
          <SelectTrigger aria-label="Payment status" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f} value={f}>{f === "all" ? "All payments" : f.charAt(0).toUpperCase() + f.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search payments"
            placeholder="Search runner or event…"
            className="w-[240px] pl-8"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={pays.data?.rows ?? []}
        isLoading={pays.isLoading}
        isError={pays.isError}
        onRetry={() => pays.refetch()}
        messages={{ loading: "Loading payments…", empty: "No payments yet.", error: "Couldn't load payments." }}
        onRowClick={(p) => p.event_id && nav(`/registrations?event=${p.event_id}`)}
        server={{
          pageIndex: t.page - 1,
          pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
          totalRows: total,
          onPageChange: (i) => t.setPage(i + 1),
          sorting: t.sort,
          onSortingChange: t.setSort,
        }}
      />
    </div>
  );
}
