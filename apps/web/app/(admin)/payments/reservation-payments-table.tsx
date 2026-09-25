"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PhotoAvatar } from "@/components/PhotoAvatar";
import { avatarTint } from "@/components/RunnerAvatar";
import { MethodBadge, methodFilterOptions } from "@/components/MethodBadge";
import { initials, peso, fmtDate } from "@/lib/format";
import { filterReservationPayments } from "@/lib/reservation-payment-filters";
import type { ReservationPaymentRow } from "@/lib/queries/reservation-payments";

const PAGE_SIZE = 20;

export function ReservationPaymentsTable({ rows, eventId }: { rows: ReservationPaymentRow[]; eventId?: string }) {
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const methods = useMemo(() => methodFilterOptions(rows.map((row) => row.method)), [rows]);
  const filtered = useMemo(() => filterReservationPayments(rows, { search, method, from, to }), [rows, search, method, from, to]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totals = filtered.reduce((sum, row) => ({
    gross: sum.gross + row.amount_cents,
    platform: sum.platform + row.platform_fee_cents,
    processing: sum.processing + row.processor_fee_cents,
    net: sum.net + row.net_to_org_cents,
  }), { gross: 0, platform: 0, processing: 0, net: 0 });
  const exportParams = new URLSearchParams();
  if (eventId) exportParams.set("event", eventId);
  if (search.trim()) exportParams.set("q", search.trim());
  if (method !== "all") exportParams.set("method", method);
  if (from) exportParams.set("from", from);
  if (to) exportParams.set("to", to);
  const exportHref = `/payments/reservations/export${exportParams.size ? `?${exportParams}` : ""}`;
  const filteredByUser = !!(search || method !== "all" || from || to);
  const update = (change: () => void) => { change(); setPage(1); };

  return <section className="mt-8" aria-labelledby="reservation-payment-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="reservation-payment-title" className="text-lg font-bold">Early reservation payments</h2>
        <p className="mt-1 text-sm text-muted-foreground">Separate, nonrefundable charges. Excluded from registration totals.</p>
      </div>
      <Link href={exportHref} className="rounded-md border border-divider px-3 py-2 text-xs font-semibold hover:bg-muted">
        Export reservation CSV
      </Link>
    </div>
    <div className="my-4 flex flex-wrap items-end gap-2" aria-label="Reservation payment filters">
      <label className="relative block min-w-[210px] flex-1 sm:max-w-[300px]">
        <span className="sr-only">Search reservation payments</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={search} onChange={(event) => update(() => setSearch(event.target.value))}
          placeholder="Search runner or event" className="h-9 w-full rounded-md border border-divider bg-card pl-9 pr-3 text-sm" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground"><span>Method</span>
        <select value={method} onChange={(event) => update(() => setMethod(event.target.value))}
          className="h-9 min-w-[125px] rounded-md border border-divider bg-card px-2 text-sm text-foreground">
          <option value="all">All methods</option>
          {methods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground"><span>Paid from</span>
        <input type="date" value={from} max={to || undefined} onChange={(event) => update(() => setFrom(event.target.value))}
          className="h-9 rounded-md border border-divider bg-card px-2 text-sm text-foreground" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground"><span>Paid to</span>
        <input type="date" value={to} min={from || undefined} onChange={(event) => update(() => setTo(event.target.value))}
          className="h-9 rounded-md border border-divider bg-card px-2 text-sm text-foreground" />
      </label>
      {filteredByUser ? <button type="button" onClick={() => { setSearch(""); setMethod("all"); setFrom(""); setTo(""); setPage(1); }}
        className="inline-flex h-9 items-center gap-1 rounded-md border border-divider px-3 text-xs font-semibold hover:bg-muted"><X className="size-3" />Clear</button> : null}
    </div>
    <Card className="gap-0 overflow-x-auto rounded-xl border py-0 shadow-card">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead><tr className="border-b border-divider text-xs text-muted-foreground">
          <th className="p-3">Runner / event</th><th className="p-3">Paid / method</th>
          <th className="p-3 text-right">Gross</th><th className="p-3 text-right">Platform Fees</th>
          <th className="p-3 text-right">PayMongo</th><th className="p-3 text-right">Net to organizer</th>
        </tr></thead>
        <tbody>{visible.length ? visible.map((row) => <tr key={row.id} className="border-b border-divider/70 last:border-0">
          <td className="p-3"><div className="flex items-center gap-2.5">
            <PhotoAvatar url={row.runner_avatar_url} className="size-[30px]"
              fallbackClassName={`text-[11.5px] font-bold ${avatarTint(row.id).bg} ${avatarTint(row.id).fg}`}
              fallback={initials(row.runner_name ?? row.runner_email)} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{row.runner_name ?? row.runner_email}</div>
              <Link href={`/events/${row.event_id}/reservations`} className="block truncate text-xs text-primary hover:underline">{row.event_name}</Link>
              {row.runner_name ? <div className="truncate text-[11px] text-muted-foreground">{row.runner_email}</div> : null}
            </div>
          </div></td>
          <td className="p-3"><div>{row.paid_at ? fmtDate(row.paid_at) : "—"}</div><MethodBadge method={row.method} status="paid" /></td>
          <td className="p-3 text-right tabular-nums">{peso(row.amount_cents)}</td>
          <td className="p-3 text-right tabular-nums">{peso(row.platform_fee_cents)}</td>
          <td className="p-3 text-right tabular-nums">{peso(row.processor_fee_cents)}</td>
          <td className="p-3 text-right font-semibold tabular-nums">{peso(row.net_to_org_cents)}</td>
        </tr>) : <tr><td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">No reservation payments match these filters.</td></tr>}</tbody>
        <tfoot><tr className="bg-muted/30 font-bold">
          <td className="p-3" colSpan={2}>{filteredByUser ? "Filtered totals" : "Reservation totals"}</td>
          <td className="p-3 text-right tabular-nums">{peso(totals.gross)}</td>
          <td className="p-3 text-right tabular-nums">{peso(totals.platform)}</td>
          <td className="p-3 text-right tabular-nums">{peso(totals.processing)}</td>
          <td className="p-3 text-right tabular-nums">{peso(totals.net)}</td>
        </tr></tfoot>
      </table>
    </Card>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>Showing {visible.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} reservation payments</span>
      {pageCount > 1 ? <div className="flex items-center gap-2">
        <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-md border border-divider px-2 py-1 disabled:opacity-40">Previous</button>
        <span>Page {page} of {pageCount}</span>
        <button type="button" disabled={page === pageCount} onClick={() => setPage(page + 1)} className="rounded-md border border-divider px-2 py-1 disabled:opacity-40">Next</button>
      </div> : null}
    </div>
  </section>;
}
