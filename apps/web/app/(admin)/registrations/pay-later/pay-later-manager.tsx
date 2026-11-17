"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatePicker } from "@race-pace/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption } from "@/components/ui/table";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { grantPayLaterAction, listPayLaterGrantsAction, searchPayLaterRunnersAction } from "@/lib/actions/pay-later";
import { PAY_LATER_PAGE_SIZE, payLaterDate, payLaterStatus, shiftPayLaterDay, type PayLaterEvent, type PayLaterGrant, type PayLaterPage, type PayLaterRunner } from "@/lib/pay-later";

const reservationHelp = "The runner chooses any available category. Categories with pre-screening require separate approval before reservation.";
const money = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

function RecordDetails({ record, event }: { record: PayLaterGrant; event: PayLaterEvent }) {
  const status = payLaterStatus(record);
  const category = record.paid_with_pay_later ? record.category_label : null;
  const notes: Record<string, string> = {
    Eligible: reservationHelp,
    "Reserved · unpaid": "One slot is held until the payment deadline.",
    "Deadline passed": "The payment deadline has passed. Payment reconciliation must finish before the slot can be released.",
    Paid: "Payment is complete and the runner’s race pass is available.",
    "Paid separately": "The runner paid through ordinary registration.",
    Expired: category ? "The reservation has expired and its slot has been released." : "Eligibility ended before the runner reserved a slot.",
    Cancelled: "The reservation was cancelled.",
    Refunded: "This entry was refunded.",
  };
  return <>
    <DialogTitle>Pay Later record</DialogTitle><DialogDescription>{event.name}</DialogDescription>
    <div className="pay-later-person"><strong>{record.full_name || "Runner"}</strong><span>{record.email}</span></div>
    <dl className="pay-later-facts">
      <div><dt>Status</dt><dd>{status}</dd></div>
      {category && <div><dt>Reserved category</dt><dd>{category}</dd></div>}
      {category && record.total_amount !== null && <div><dt>Entry amount</dt><dd>{money(record.total_amount)}</dd></div>}
      <div><dt>Payment deadline</dt><dd>{payLaterDate(record.due_date)} · 11:59 p.m. Philippine time</dd></div>
    </dl>
    <p className="pay-later-note">{notes[status]}</p>
    <div className="pay-later-dialog-actions"><DialogClose asChild><Button>Done</Button></DialogClose></div>
  </>;
}

function GrantForm({ event, today, onSaved, onSaving }: { event: PayLaterEvent; today: string; onSaving: (saving: boolean) => void; onSaved: (record: PayLaterGrant) => void }) {
  const defaultDue = event.event_date ? shiftPayLaterDay(event.event_date, -28) : "";
  const [dueDate, setDueDate] = useState(defaultDue > today ? defaultDue : "");
  const [query, setQuery] = useState("");
  const [runner, setRunner] = useState<PayLaterRunner | null>(null);
  const [results, setResults] = useState<PayLaterRunner[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true;
    setResults([]); setSearchError("");
    const term = query.trim();
    if (runner || term.length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await searchPayLaterRunnersAction({ eventId: event.id, query: term });
        if (!active) return;
        if (result.ok) setResults(result.data);
        else setSearchError(result.error);
      } catch { if (active) setSearchError("Runner accounts could not be loaded. Try again."); }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [event.id, query, runner]);

  async function submit(eventSubmit: React.FormEvent) {
    eventSubmit.preventDefault();
    if (savingRef.current) return;
    setError("");
    if (!runner) { setError("Select a runner to continue."); searchRef.current?.focus(); return; }
    if (!dueDate || dueDate <= today || !event.event_date || dueDate >= event.event_date) {
      setError("Choose a future payment date before event day."); return;
    }
    if (!reviewing) { setReviewing(true); return; }
    savingRef.current = true; setSaving(true); onSaving(true);
    try {
      const result = await grantPayLaterAction({ eventId: event.id, runnerId: runner.user_id, dueDate });
      if (result.ok) onSaved(result.data);
      else setError(result.error);
    } catch { setError("The grant could not be confirmed. Refresh the roster before retrying."); }
    finally { savingRef.current = false; setSaving(false); onSaving(false); }
  }
  return <>
    <DialogTitle>{reviewing ? "Confirm Pay Later" : "Grant Pay Later"}</DialogTitle>
    <DialogDescription>{event.name}{event.event_date ? " · " + payLaterDate(event.event_date) : ""}</DialogDescription>
    <form onSubmit={submit} className="pay-later-form" noValidate>
      {reviewing && runner ? <>
        <div className="pay-later-person"><strong>{runner.full_name || "Runner"}</strong><span>{runner.email}</span></div>
        <dl className="pay-later-facts">
          <div><dt>Event</dt><dd>{event.name}</dd></div>
          <div><dt>Payment deadline</dt><dd>{payLaterDate(dueDate)} · 11:59 p.m. Philippine time</dd></div>
          <div><dt>Email reminders</dt><dd>7 days and 1 day before payment is due</dd></div>
        </dl>
        <p className="pay-later-note">{reservationHelp}</p>
        <p className="pay-later-help">An existing grant keeps its original deadline.</p>
      </> : <>
        <div className="pay-later-field">
          {runner ? <><span className="pay-later-label">Runner account</span><div className="pay-later-selection">
            <div className="pay-later-person"><strong>{runner.full_name || "Runner"}</strong><span>{runner.email}</span></div>
            <Button type="button" variant="ghost" onClick={() => { setRunner(null); setError(""); requestAnimationFrame(() => searchRef.current?.focus()); }}>Change runner</Button>
          </div></> : <>
            <Label htmlFor="pay-later-runner">Runner account</Label>
            <Input ref={searchRef} id="pay-later-runner" type="search" autoComplete="off" maxLength={200}
              placeholder="Search by name or exact email" value={query} aria-describedby="pay-later-search-help"
              onChange={eventInput => setQuery(eventInput.target.value)} />
            <p className="pay-later-help" id="pay-later-search-help">Search this organization’s runners by name. For a new runner, enter their full account email.</p>
            {searching && <p role="status" className="pay-later-help">Searching runner accounts…</p>}
            {searchError && <Alert variant="destructive" className="pay-later-error"><AlertDescription>{searchError}</AlertDescription></Alert>}
            {!searching && !searchError && query.trim().length >= 2 && <div className="pay-later-matches">
              {results.length ? results.map(person => <Button key={person.user_id} type="button" variant="ghost" className="pay-later-search-result"
                onClick={() => { setRunner(person); setError(""); }}>
                <span><strong>{person.full_name || "Runner"}</strong><small>{person.email}</small></span><span>Select</span>
              </Button>) : <p role="status">No matching account. Check the name or full email.</p>}
            </div>}
          </>}
        </div>
        <div className="pay-later-field">
          <Label htmlFor="pay-later-due">Payment due date</Label>
          <DatePicker id="pay-later-due" value={dueDate} onValueChange={value => {setDueDate(value);setError("");}}
            min={shiftPayLaterDay(today,1)} max={event.event_date ? shiftPayLaterDay(event.event_date,-1) : undefined}
            aria-describedby="pay-later-due-help" />
          <p className="pay-later-help" id="pay-later-due-help">{defaultDue <= today ? "The default deadline has passed. Choose a future date before event day." : "Defaults to four weeks before event day."} Payment closes at 11:59 p.m. Philippine time.</p>
        </div>
      </>}
      {error && <Alert variant="destructive" className="pay-later-error"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="pay-later-dialog-actions">
        {reviewing ? <Button type="button" variant="outline" disabled={saving} onClick={() => setReviewing(false)}>Back</Button> :
          <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>}
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : reviewing ? "Confirm eligibility" : "Review grant"}</Button>
      </div>
    </form>
  </>;
}

export function PayLaterManager({ events, event, initialPage, initialError, today }: {
  events: PayLaterEvent[]; event: PayLaterEvent; initialPage: PayLaterPage; initialError: string; today: string;
}) {
  const router = useRouter();
  const [navigationPending, startTransition] = useTransition();
  const [page, setPage] = useState(0);
  const [roster, setRoster] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [grantOpen, setGrantOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<PayLaterGrant | null>(null);
  const [saved, setSaved] = useState(false);
  const grantButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const request = useRef(0);
  const closed = !event.event_date || shiftPayLaterDay(today,1) >= event.event_date ||
    !["open","almost_full"].includes(event.status);
  const showCategory = roster.rows.some(row => row.paid_with_pay_later && row.category_label);

  useEffect(() => () => { request.current++; }, []);

  async function load(nextPage: number) {
    const generation = ++request.current;
    setLoading(true); setError("");
    try {
      let result = await listPayLaterGrantsAction({ eventId: event.id, page: nextPage });
      if (generation !== request.current) return;
      if (result.ok && !result.data.rows.length && nextPage > 0) {
        nextPage = 0;
        result = await listPayLaterGrantsAction({eventId:event.id,page:0});
        if (generation !== request.current) return;
      }
      if (result.ok) { setRoster(result.data); setPage(nextPage); }
      else setError(result.error);
    } catch { if (generation === request.current) setError("Pay Later approvals could not be loaded. Try again."); }
    finally { if (generation === request.current) setLoading(false); }
  }

  return <div className="fieldnotes-admin-workspace pay-later-workspace">
    <Link className="pay-later-back" href={"/registrations?event=" + event.id}>Registrations</Link>
    <div className="pay-later-heading"><h1>Pay Later</h1><p>Approve runners to reserve a place in this event and set their payment deadline.</p></div>
    <section className="pay-later-filters" aria-label="Registration filters">
      <div className="pay-later-field"><Label htmlFor="pay-later-event">Event</Label>
        <Select value={event.id} disabled={navigationPending} onValueChange={id => startTransition(() => router.push("/registrations/pay-later?event=" + id))}>
          <SelectTrigger id="pay-later-event" aria-busy={navigationPending}><SelectValue /></SelectTrigger>
          <SelectContent>{events.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {event.event_date && <dl className="pay-later-dates"><div><dt>Event day</dt><dd>{payLaterDate(event.event_date)}</dd></div>
        <div><dt>Default deadline</dt><dd>{payLaterDate(shiftPayLaterDay(event.event_date,-28))}</dd></div></dl>}
    </section>
    <section className="pay-later-ledger" aria-labelledby="pay-later-roster">
      <div className="pay-later-ledger-heading"><h2 id="pay-later-roster">Runner approvals <span>{roster.total}</span></h2>
        <div className="pay-later-grant-action"><Button ref={grantButton} disabled={closed} aria-describedby={closed ? "pay-later-closed" : undefined}
          onClick={() => {opener.current=grantButton.current;setSaved(false);setGrantOpen(true);}}>Grant Pay Later</Button>
          {closed && <p id="pay-later-closed">{!event.event_date ? "Set the event date before granting access." : !["open","almost_full"].includes(event.status) ? "Open registration for this event before creating new grants." : "No future payment date remains before event day."}</p>}
        </div>
      </div>
      {error && <div className="pay-later-read-error"><Alert variant="destructive" className="pay-later-error"><AlertDescription>{error}</AlertDescription></Alert><Button variant="outline" disabled={loading} onClick={()=>void load(page)}>Retry</Button></div>}
      {loading && <p role="status" className="pay-later-empty">Loading approvals…</p>}
      {!error && !loading && !roster.rows.length && <p className="pay-later-empty">No approvals for this event.</p>}
      {!loading && roster.rows.length > 0 && <Table className="pay-later-rows"><TableCaption className="sr-only">Runner approvals for {event.name}</TableCaption>
        <TableHeader><TableRow>{["Runner",...(showCategory?["Reserved category"]:[]),"Status","Deadline",""].map(name=><TableHead key={name} scope="col">{name || <span className="sr-only">Actions</span>}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{roster.rows.map(row=><TableRow key={row.id}><TableHead scope="row"><div className="pay-later-person"><strong>{row.full_name || "Runner"}</strong><span>{row.email}</span></div></TableHead>
          {showCategory && <TableCell data-label="Reserved category">{row.paid_with_pay_later ? row.category_label || "—" : "—"}</TableCell>}
          <TableCell data-label="Status">{payLaterStatus(row)}</TableCell><TableCell data-label="Deadline">{payLaterDate(row.due_date)}</TableCell>
          <TableCell className="pay-later-record-action"><Button variant="outline" size="sm" onClick={click => {opener.current=click.currentTarget;setSaved(false);setRecord(row);}}>View record</Button></TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      <div className="pay-later-pagination"><Button variant="ghost" disabled={loading} onClick={()=>void load(page)}>Refresh</Button>
        <div><span>Page {page+1}</span><Button variant="outline" disabled={loading || page===0} onClick={()=>void load(page-1)}>Previous</Button>
          <Button variant="outline" disabled={loading || (page+1)*PAY_LATER_PAGE_SIZE >= roster.total} onClick={()=>void load(page+1)}>Next</Button></div>
      </div>
    </section>
    <Dialog open={grantOpen || !!record} onOpenChange={open=>{if(!open && !saving){setGrantOpen(false);setRecord(null);}}}>
      <DialogContent className="pay-later-dialog" onCloseAutoFocus={focus=>{focus.preventDefault();(opener.current?.isConnected?opener.current:grantButton.current)?.focus();}}>
        {record ? <>{saved && <p role="status" className="pay-later-save-note">Pay Later access confirmed.</p>}<RecordDetails record={record} event={event}/></> :
          <GrantForm event={event} today={today} onSaving={setSaving} onSaved={row=>{setGrantOpen(false);setSaved(true);setRecord(row);void load(0);router.refresh();}}/>}
      </DialogContent>
    </Dialog>
  </div>;
}
