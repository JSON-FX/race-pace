"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Check, Ticket, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PhotoAvatar } from "@/components/PhotoAvatar";
import { EventCombobox } from "@/components/EventCombobox";
import { useReportPending } from "@/components/NavProgress";
import { fmtDate, initials, peso } from "@/lib/format";
import type { ReservationRow, ReservationSummary } from "@/lib/queries/reservations";

const PAGE_SIZE = 25;
const date = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
const time = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
function DateValue({ value }: { value: string | null }) {
  if (!value) return <span className="reservation-dash">—</span>;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return <span className="reservation-dash">—</span>;
  return <time dateTime={value} className="reservation-date">{date.format(parsed)}<span>{time.format(parsed)} PHT</span></time>;
}
function DueDate({ row }: { row: ReservationRow }) {
  const uniqueDates = [...new Set(row.deadlines.map(deadline => deadline.at))];
  if (uniqueDates.length <= 1) return <DateValue value={uniqueDates[0] ?? null} />;
  return <div className="reservation-deadlines">{row.deadlines.map((deadline, index) => <div key={`${deadline.category}-${index}`}><span className="reservation-deadline-category">{deadline.category}</span><DateValue value={deadline.at} /></div>)}</div>;
}
function RunnerAvatar({ row }: { row: ReservationRow }) {
  return <PhotoAvatar url={row.avatarUrl} fallback={initials(row.name)} className="size-10" fallbackClassName="text-primary bg-paid-tint text-[13px] font-semibold" />;
}
function PaymentStatus({ value }: { value: string }) {
  return <span className={`reservation-status reservation-status--${value === "Paid" ? "paid" : value === "Pending" ? "pending" : "other"}`}>
    {value === "Paid" && <Check size={14} aria-hidden />}{value}
  </span>;
}
function ManagedRunners({ row }: { row: ReservationRow }) {
  return <>{row.managed.map((runner, index) => <span className="reservation-managed" key={index}>Managed: {runner.name} · {runner.category}</span>)}
    {row.converted && <span className="reservation-managed">Converted to registration</span>}</>;
}
export function ReservationsWorkspace({ events, eventId, orgName, rows = [], summary }: {
  events: { id: string; name: string; event_date: string | null }[];
  eventId: string | null; orgName: string; rows?: ReservationRow[]; summary?: ReservationSummary;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useReportPending(pending);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All payments");
  const [page, setPage] = useState(0);
  const selected = events.find(event => event.id === eventId);
  const filtered = rows.filter(row => `${row.name} ${row.email} ${row.managed.map(runner => runner.name).join(" ")}`.toLowerCase().includes(query.toLowerCase()) && (status === "All payments" || row.paymentStatus === status));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const statuses = [...new Set(["Paid", "Pending", ...rows.map(row => row.paymentStatus)])];
  function clearFilters() { setQuery(""); setStatus("All payments"); setPage(0); }
  return <div className="reservation-main">
    <div className="reservation-heading"><h1>Reservations</h1><p>Early places, payment status, and entry deadlines for your event.</p></div>
    <div className="reservation-event-picker"><label>Event</label><EventCombobox events={events} value={eventId} label="Event" placeholder="Choose an event" busy={pending} className="reservation-event" onSelect={id => startTransition(() => router.push(`/reservations?event=${encodeURIComponent(id)}`, { scroll: false }))} />
      {selected?.event_date && <p>{fmtDate(selected.event_date)}</p>}</div>
    <section className="reservation-summary" aria-label="Event reservation summary">
      <Card><h2>Total reservations</h2><strong>{summary ? summary.total.toLocaleString() : "—"}</strong><p>Reservation checkouts for this event</p></Card>
      <Card><h2>Reservations paid</h2><strong>{summary ? summary.paid.toLocaleString() : "—"}</strong><p>Paid checkouts, including converted entries</p></Card>
      <Card><h2>Total paid amount</h2><strong className="reservation-summary-money">{summary ? peso(summary.paidAmountCents) : "—"}</strong><p>Collected amount, including fees</p></Card>
      <Card><h2>Pending payments</h2><strong>{summary ? summary.pending.toLocaleString() : "—"}</strong><p>Checkouts awaiting payment</p></Card>
    </section>
    {!selected ? <section className="reservation-empty"><Ticket size={32} aria-hidden /><h2>{events.length ? "Choose an event to view reservations" : "No events yet"}</h2><p>{events.length ? `Only events from ${orgName} appear in the event selector.` : "Create an event before you can take reservations."}</p></section>
      : <section className="reservation-roster" aria-labelledby="reservation-roster-title">
        <div className="reservation-roster-heading"><div><h2 id="reservation-roster-title">Reservation roster</h2><p>One checkout per row. Managed runners appear beneath the booking account.</p></div><span>{summary?.total.toLocaleString()} checkouts</span></div>
        <div className="reservation-toolbar"><div className="reservation-search"><Search size={18} aria-hidden /><Input aria-label="Search runners" placeholder="Search runner name or email" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></div>
          <Select value={status} onValueChange={value => { setStatus(value); setPage(0); }}><SelectTrigger aria-label="Payment status filter"><SelectValue /></SelectTrigger><SelectContent>{["All payments", ...statuses].map(value => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select>
        </div>
        {shown.length === 0 ? <div className="reservation-empty"><h3>{rows.length ? "No matching reservations" : "No reservations yet"}</h3><p>{rows.length ? "Try another name, email, or payment status." : "This event’s reservations will appear here."}</p>{rows.length > 0 && <Button variant="outline" onClick={clearFilters}>Clear filters</Button>}</div>
          : <><div className="reservation-desktop-table"><Table><TableHeader><TableRow>{["Avatar", "Runner name", "Runner email", "Category", "Payment status", "Payment date", "Entry payment due", "Reservation amount"].map(label => <TableHead key={label} scope="col">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{shown.map(row => <TableRow key={row.id}>
            <TableCell><RunnerAvatar row={row} /></TableCell><TableCell><strong>{row.name}</strong><ManagedRunners row={row} /></TableCell>
            <TableCell className="reservation-email">{row.email}</TableCell><TableCell><span className="reservation-categories">{row.categories.length ? row.categories.map(category => <span key={category}>{category}</span>) : "—"}</span></TableCell>
            <TableCell><PaymentStatus value={row.paymentStatus} /></TableCell><TableCell><DateValue value={row.paidAt} /></TableCell><TableCell><DueDate row={row} /></TableCell>
            <TableCell className="reservation-amount">{row.amountCents !== null ? peso(row.amountCents) : <span className="reservation-dash">—</span>}</TableCell>
          </TableRow>)}</TableBody></Table></div>
          <div className="reservation-mobile-list">{shown.map(row => <article key={row.id}><header><RunnerAvatar row={row} /><div><h3>{row.name}</h3><p>{row.email}</p></div><PaymentStatus value={row.paymentStatus} /></header><ManagedRunners row={row} />
            <dl><div><dt>Category</dt><dd>{row.categories.join(" · ") || "—"}</dd></div><div><dt>Reservation amount</dt><dd>{row.amountCents !== null ? peso(row.amountCents) : "—"}</dd></div>
              <div><dt>Payment date</dt><dd><DateValue value={row.paidAt} /></dd></div><div><dt>Entry payment due</dt><dd><DueDate row={row} /></dd></div></dl></article>)}</div></>}
        <footer className="reservation-table-footer"><p>{filtered.length ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length} checkouts` : "0 checkouts"}</p><div><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ArrowLeft size={18} /></Button><Button variant="outline" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(page + 1)} aria-label="Next page"><ArrowRight size={18} /></Button></div></footer>
      </section>}
    <p className="reservation-note">{selected ? "Reservation amounts show collected payments, including platform and processing fees. Unpaid checkouts show —. All dates use Philippine time." : "Choose an event to see its reservation checkouts and payments."}</p>
  </div>;
}
