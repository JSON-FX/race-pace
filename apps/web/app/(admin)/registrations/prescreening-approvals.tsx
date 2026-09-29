"use client";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ScreeningEmailStatus } from "@/components/ScreeningEmailStatus";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableHead, TableRow, TableCell, TableBody } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Review = {
  id: string; batch_id: string; participant_name: string; category_id: string; is_managed: boolean;
  decision: "pending" | "approved" | "rejected"; created_at: string; released_at: string | null;
  proof_upload_id: string; requirement_snapshot: string; explanation: string | null; rejection_reason: string | null;
  categories: { label: string }; prescreening_batches: { status: string; checkout_intent: string; payment_deadline_at: string | null };
};
const date = (value: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function PrescreeningApprovals({ eventId, orgId }: { eventId: string; orgId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Review[]>([]); const [count, setCount] = useState(0); const [pendingCount, setPendingCount] = useState(0);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [search, setSearch] = useState(""); const [category, setCategory] = useState("all"); const [decision, setDecision] = useState("pending");
  const [page, setPage] = useState(0); const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Review | null>(null); const [proof, setProof] = useState<string | null>(null);
  const [proofZoomed, setProofZoomed] = useState(false);
  const [proofLoading, setProofLoading] = useState(false); const [proofError, setProofError] = useState<string | null>(null);
  const [reason, setReason] = useState(""); const [rejecting, setRejecting] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [reviewError, setReviewError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); const db = createClient(); setLoading(true); setError(null);
    const timer = setTimeout(async () => {
      let query = db.from("prescreening_applications")
        .select("id,batch_id,participant_name,category_id,is_managed,decision,created_at,released_at,proof_upload_id,requirement_snapshot,explanation,rejection_reason,categories(label),prescreening_batches(status,checkout_intent,payment_deadline_at)", { count: "exact" })
        .eq("event_id", eventId).eq("org_id", orgId).eq("screening_required", true).order("created_at").order("id");
      if (decision !== "all") query = query.eq("decision", decision);
      if (decision === "pending") query = query.is("released_at", null);
      if (category !== "all") query = query.eq("category_id", category);
      if (search.trim()) query = query.ilike("participant_name", `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`);
      const [result, cats, pending] = await Promise.all([
        query.range(page * 20, page * 20 + 19).abortSignal(controller.signal),
        db.from("categories").select("id,label").eq("event_id", eventId).eq("org_id", orgId).order("label").abortSignal(controller.signal),
        db.from("prescreening_applications").select("id", { head: true, count: "exact" }).eq("event_id", eventId).eq("org_id", orgId).eq("decision", "pending").is("released_at", null).abortSignal(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (result.error || cats.error || pending.error) setError("Pre-screening requests could not be loaded. Try again.");
      else { setRows((result.data ?? []) as unknown as Review[]); setCount(result.count ?? 0); setCategories(cats.data ?? []); setPendingCount(pending.count ?? 0); }
      setLoading(false);
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [eventId, orgId, search, category, decision, page, revision]);
  useEffect(() => { setPage(0); setSelected(null); }, [eventId, orgId]);
  useEffect(() => {
    let active = true; setProof(null); setProofZoomed(false); setProofError(null); setReason(""); setRejecting(false); setReviewError(null);
    if (!selected) return;
    setProofLoading(true);
    void createClient().functions.invoke("prescreening-proof", { body: { action: "view", upload_id: selected.proof_upload_id } }).then(({ data, error }) => {
      if (!active) return;
      if (error || typeof data?.url !== "string") setProofError("This private proof could not be opened. Close and reopen the review to retry.");
      else setProof(data.url);
      setProofLoading(false);
    });
    return () => { active = false; };
  }, [selected]);
  async function review(value: "approved" | "rejected") {
    if (!selected || busy || (value === "rejected" && !reason.trim())) return;
    setBusy(true); setReviewError(null);
    const { error } = await createClient().rpc("prescreening_review", { p_application: selected.id, p_decision: value, p_reason: value === "rejected" ? reason.trim() : null });
    if (error) setReviewError(error.message.includes("extend_payment_deadline")
      ? "Extend the category’s full entry deadline or the event’s registration close to allow 72 hours, then approve again. This decision has not been saved."
      : error.message.includes("review_already_decided") ? "Another reviewer already decided this request. Close it and refresh the table."
      : "The decision could not be saved. Refresh and check its status before retrying.");
    else { setSelected(null); setRevision(n => n + 1); router.refresh(); }
    setBusy(false);
  }
  const reviewable = selected?.decision === "pending" && !selected.released_at && selected.prescreening_batches.status === "reviewing";
  return <section className="mt-8" aria-labelledby="screening-title">
    <div className="flex flex-wrap items-center gap-3"><h2 id="screening-title" className="text-lg font-bold">Pre-screening approvals</h2><Badge variant="secondary">{pendingCount} pending</Badge><Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(n => n + 1)}>Refresh reviews</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Review each Passport’s proof. Its slot stays held until a decision. Pending reviews do not expire automatically.</p>
    <div className="my-4 flex flex-col gap-3 sm:flex-row">
      <Input aria-label="Search pre-screening runners" placeholder="Search runner" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="sm:flex-1" />
      <Select value={category} onValueChange={value => { setCategory(value); setPage(0); }}><SelectTrigger aria-label="Filter pre-screening category" className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select>
      <Select value={decision} onValueChange={value => { setDecision(value); setPage(0); }}><SelectTrigger aria-label="Filter pre-screening status" className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pending review</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="all">All decisions</SelectItem></SelectContent></Select>
    </div>
    {error && <Alert variant="destructive" className="mb-3 text-sm text-destructive"><AlertDescription>{error} <Button variant="ghost" onClick={() => setRevision(n => n + 1)}>Retry</Button></AlertDescription></Alert>}
    <div className="overflow-x-auto rounded-xl border bg-card" aria-busy={loading}><Table className="min-w-[700px]">
      <TableHeader><TableRow><TableHead>Runner</TableHead><TableHead>Category</TableHead><TableHead>Submitted</TableHead><TableHead>Status</TableHead><TableHead>Slot</TableHead><TableHead><span className="sr-only">Review</span></TableHead></TableRow></TableHeader>
      <TableBody>{loading ? <TableRow><TableCell colSpan={6} className="p-6">Loading pre-screening requests…</TableCell></TableRow> : !rows.length ? <TableRow><TableCell colSpan={6} className="p-6">No requests match these filters.</TableCell></TableRow> : rows.map(row => <TableRow key={row.id}>
        <TableCell><p className="font-semibold">{row.participant_name}</p><p className="text-xs text-muted-foreground">{row.is_managed ? "Managed Passport" : "Booker’s Passport"}</p></TableCell>
        <TableCell>{row.categories.label}</TableCell><TableCell><p>{date(row.created_at)} PHT</p><p className="text-xs text-muted-foreground">Group {row.batch_id.slice(0, 8)}</p></TableCell>
        <TableCell><Badge variant={row.decision === "rejected" ? "destructive" : "secondary"}>{row.decision === "pending" ? "Pending review" : row.decision === "approved" ? "Approved" : "Rejected"}</Badge></TableCell>
        <TableCell>{row.prescreening_batches.status === "completed" && row.decision !== "rejected" ? "Paid booking" : row.released_at ? "Released" : "Held"}</TableCell>
        <TableCell><Button variant="outline" onClick={() => setSelected(row)}>Review proof<span className="sr-only"> for {row.participant_name}</span></Button></TableCell>
      </TableRow>)}</TableBody></Table></div>
    <div className="mt-3 flex items-center justify-between gap-3 text-xs"><p>{count} requests · Private proof</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!page || loading} onClick={() => setPage(p => p - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={(page + 1) * 20 >= count || loading} onClick={() => setPage(p => p + 1)}>Next</Button></div></div>
    <p className="mt-4 rounded-lg bg-muted p-3 text-xs leading-relaxed"><strong>Groups pay together.</strong> Approval unlocks payment only when every required review is approved. Rejection releases only that Passport’s slot. Participants in categories without requirements are already ready and are not in this review queue.</p>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !busy) setSelected(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto" style={{ width: "min(940px, calc(100vw - 32px))", maxWidth: "940px" }}><DialogHeader><DialogTitle>Review {selected?.participant_name}</DialogTitle><DialogDescription>{selected?.categories.label} · {selected?.is_managed ? "Managed Passport" : "Booker’s Passport"}</DialogDescription></DialogHeader>
      <div className="space-y-5"><div className="grid gap-5 md:grid-cols-2">
        <div className="min-w-0 rounded-xl border bg-muted p-3">
          {proofLoading && <p role="status" className="p-5 text-sm">Opening private proof…</p>}{proofError && <Alert variant="destructive" className="text-sm text-destructive"><AlertDescription>{proofError}</AlertDescription></Alert>}
          {proof && <div className="space-y-2 text-center"><div className={proofZoomed ? "max-h-[48dvh] overflow-auto rounded-lg bg-background" : "rounded-lg bg-background"}><img src={proof} alt={`Submitted qualification proof for ${selected?.participant_name}`} referrerPolicy="no-referrer" className={proofZoomed ? "mx-auto h-auto w-[160%] max-w-none" : "mx-auto max-h-[36dvh] w-full object-contain"} onError={() => { setProof(null); setProofError("The image link expired or could not load. Close and reopen to get a fresh link."); }} /></div><p className="text-xs text-muted-foreground">Private proof · visible to authorized reviewers</p><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" size="sm" aria-pressed={proofZoomed} onClick={() => setProofZoomed(value => !value)}>{proofZoomed ? "Fit proof" : "Zoom proof"}</Button><Button variant="outline" size="sm" asChild><a href={proof} target="_blank" rel="noopener noreferrer" aria-label={`Open full proof for ${selected?.participant_name}`}>Open full image</a></Button></div></div>}
        </div>
        <div className="min-w-0 space-y-4 text-sm"><dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-2"><dt className="text-muted-foreground">Runner</dt><dd className="font-medium">{selected?.participant_name}</dd><dt className="text-muted-foreground">Passport</dt><dd>{selected?.is_managed ? "Managed Passport" : "Booker’s Passport"}</dd><dt className="text-muted-foreground">Category</dt><dd>{selected?.categories.label}</dd><dt className="text-muted-foreground">Status</dt><dd className="capitalize">{selected?.decision}</dd><dt className="text-muted-foreground">Slot</dt><dd>{selected?.released_at ? "Released" : "Held for this participant"}</dd></dl>
          <div><h3 className="font-semibold">Requirement when submitted</h3><p className="mt-1 whitespace-pre-line leading-relaxed text-muted-foreground">{selected?.requirement_snapshot}</p></div>
          <div><h3 className="font-semibold">Runner’s explanation</h3><p className="mt-1 whitespace-pre-line leading-relaxed text-muted-foreground">{selected?.explanation || "No explanation provided."}</p></div>
          {selected?.rejection_reason && <p className="rounded-lg bg-muted p-3">Rejection reason: {selected.rejection_reason}</p>}
          {reviewable && <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed">Review this participant independently. Rejection releases only this runner’s slot.</p>}
        </div>
      </div>
        {selected && <ScreeningEmailStatus batchId={selected.batch_id} payable={selected.prescreening_batches.status === "ready" && Date.parse(selected.prescreening_batches.payment_deadline_at ?? "") > Date.now()} />}
        {reviewable && <>{rejecting && <div><Label htmlFor="screening-rejection">Reason for rejection <span aria-hidden="true">*</span></Label><Textarea id="screening-rejection" autoFocus rows={3} maxLength={4000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} className="mt-2" /><p className="mt-1 text-xs text-muted-foreground">Required. The booker will see this reason.</p></div>}
          <div className="flex flex-wrap justify-end gap-3">{rejecting ? <><Button variant="outline" disabled={busy} onClick={() => setRejecting(false)}>Back</Button><Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => void review("rejected")}>Reject and release slot</Button></> : <><Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button><Button disabled={busy || !proof} onClick={() => void review("approved")}>{busy ? "Saving…" : "Approve participant"}</Button></>}</div>
        </>}{reviewError && <Alert variant="destructive" className="text-sm text-destructive"><AlertDescription>{reviewError}</AlertDescription></Alert>}
      </div>
    </DialogContent></Dialog>
  </section>;
}
