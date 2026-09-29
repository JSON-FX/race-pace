"use client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CategoryInclusions } from "@/components/event/CategoryInclusions";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPeso, type PrescreeningRequest } from "@race-pace/shared";
import type { CategoryRow, EventRow } from "@/lib/events";
import { screeningOperation } from "@/lib/prescreening";
import { ProofUpload } from "@/components/prescreening/ProofUpload";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Info, LockKeyhole } from "lucide-react";
import { PassportAvatar } from "@/components/prescreening/PassportAvatar";
import styles from "@/components/prescreening/screening.module.css";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Passport = { id: string; claimed_user_id: string | null; first_name: string | null; last_name: string | null };
type Line = { category: string; proof?: string; explanation: string };
export function ScreeningRequest({ event, categories, initialCategory, intent, passports, userId, initialParticipants = [] }: {
  initialParticipants?: { passportId: string; categoryId: string }[];
  event: EventRow; categories: CategoryRow[]; initialCategory: string; intent: "entry" | "reservation"; passports: Passport[]; userId: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Record<string, Line>>(() => Object.fromEntries(initialParticipants.map(p => [p.passportId, { category: p.categoryId, explanation: "" }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reuse the exact submitted payload after a transport failure. Editing the
  // form starts a fresh attempt; it never silently reuses a changed request.
  const [attempt, setAttempt] = useState<PrescreeningRequest | null>(null);
  const selected = passports.filter(p => lines[p.id]);
  const needsReview = selected.length
    ? selected.some(p => categories.find(c => c.id === lines[p.id].category)?.prescreening_enabled)
    : !!categories.find(c => c.id === initialCategory)?.prescreening_enabled;
  const unavailable = selected.some(p => {
    const category = categories.find(c => c.id === lines[p.id].category);
    return !category || (intent === "reservation" ? category.reservation_available === 0 : category.general_available === 0);
  });
  const update = (id: string, patch: Partial<Line>) => { setAttempt(null); setLines(current => ({ ...current, [id]: { ...current[id], ...patch } })); };
  const pendingProof = selected.some(p => categories.find(c => c.id === lines[p.id].category)?.prescreening_enabled && !lines[p.id].proof);
  async function submit() {
    setError(null); setBusy(true);
    const request: PrescreeningRequest = attempt ?? { event_id: event.id, idempotency_key: crypto.randomUUID(), checkout_intent: intent,
      participants: selected.map(p => ({ participant_passport_id: p.id, category_id: lines[p.id].category,
        ...(lines[p.id].proof ? { proof_upload_id: lines[p.id].proof } : {}), explanation: lines[p.id].explanation })) };
    setAttempt(request);
    try {
      const result = await screeningOperation<{ batch_id: string }>("prescreening-submit", request);
      router.push(`/prescreening/${result.batch_id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit. Try again."); }
    finally { setBusy(false); }
  }
  return <main className={styles.workspace}><div className={styles.wrap}><header className={styles.heading}>
    <Link href={`/events/${event.slug ?? event.id}`} className={styles.breadcrumb}><ArrowLeft aria-hidden="true" /><span>{event.name}</span></Link>
    <h1>{needsReview ? "Request pre-screening" : intent === "reservation" ? "Reserve places" : "Choose your category"}</h1>
    <p>All selected slots are held after you submit. Send proof for each runner who needs review.</p>
    </header><div className={styles.columns}>
      <section className={styles.panel} aria-label="Pre-screening request">
        <div className={styles.formIntro}><h2>Who’s joining?</h2><p className="mt-1 text-sm text-muted-foreground">Choose your own or managed Race Passports. The group pays together once everyone is ready.</p></div>
        <fieldset disabled={busy} className="space-y-0"><legend className="sr-only">Select Race Passports</legend>
          {passports.map(p => <Label key={p.id} className={styles.passport}><Checkbox checked={!!lines[p.id]} disabled={!lines[p.id] && selected.length >= 10} onCheckedChange={checked => {
            setAttempt(null); setLines(current => { const next = { ...current }; if (checked) next[p.id] = { category: initialCategory, explanation: "" }; else delete next[p.id]; return next; });
          }} /><PassportAvatar name={`${p.first_name ?? ""} ${p.last_name ?? ""}`} managed={p.claimed_user_id !== userId} /><span className={styles.passportName}>{p.first_name} {p.last_name}<small>{p.claimed_user_id === userId ? "Your Passport" : "Managed Passport"}</small></span>{lines[p.id] && <span className={styles.selected}>Selected</span>}</Label>)}
        </fieldset>
        {!passports.length && <p>No Passports yet. <Link className="underline" href="/profile">Create your Race Passport</Link>.</p>}
        {selected.map(p => {
          const line = lines[p.id], category = categories.find(c => c.id === line.category)!;
          const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Runner";
          return <section key={p.id} className={styles.participant} aria-labelledby={`runner-${p.id}`}>
            <div className={styles.participantHeading}><PassportAvatar name={name} managed={p.claimed_user_id !== userId} /><div className={styles.passportName}><h3 id={`runner-${p.id}`}>{name}</h3><small>{p.claimed_user_id === userId ? "Your Passport" : "Managed Passport"}</small></div></div>
            <div className={styles.formField}><Label htmlFor={`category-${p.id}`}>Category</Label><Select disabled={busy} value={line.category} onValueChange={category => update(p.id, { category, proof: undefined })}>
              <SelectTrigger id={`category-${p.id}`} className="mt-2 w-full"><SelectValue /></SelectTrigger><SelectContent>
                {categories.map(c => <SelectItem key={c.id} value={c.id} disabled={intent === "reservation"
                  ? !c.reservation_enabled || c.reservation_available === 0 || !c.reservation_sales_close_at || Date.parse(c.reservation_sales_close_at) <= Date.now()
                  : c.general_available === 0}>{c.label} · {formatPeso(c.base_price)}</SelectItem>)}
              </SelectContent></Select></div>
            {category.prescreening_enabled ? <>
              <div className={styles.formField}><h4>Pre-screening requirement</h4><p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{category.prescreening_requirement}</p></div>
              <ProofUpload key={`${p.id}:${category.id}`} passportId={p.id} categoryId={category.id} name={name} disabled={busy} onVerified={proof => update(p.id, { proof })} />
              <div className={styles.formField}><Label htmlFor={`explanation-${p.id}`}>Anything else the organizer should know? <span className="font-normal text-muted-foreground">Optional</span></Label>
                <Textarea id={`explanation-${p.id}`} disabled={busy} rows={3} maxLength={4000} value={line.explanation} onChange={e => update(p.id, { explanation: e.target.value })} className="mt-2" placeholder="Add context about your previous race or proof." />
                <p className="mt-1 text-xs text-muted-foreground">Visible only to you and authorized organizer reviewers.</p></div>
            </> : <p className={styles.note}>No review needed for this category. This runner’s slot is held with the group{needsReview ? " while other runners await approval" : " until group payment"}.</p>}
            <CategoryInclusions items={category.inclusions ?? []} />
          </section>;
        })}
        <div className={styles.due}><div className="flex justify-between font-semibold"><span>Due now</span><span>₱0</span></div><p className="mt-2 text-sm text-muted-foreground">No entry or reservation payment on this form. Every selected slot is secured only when submission succeeds.</p></div>
        {error && <Alert variant="destructive" className="text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button className={`${styles.button} ${styles.fullButton}`} disabled={busy || !selected.length || pendingProof || unavailable} onClick={submit}>{busy ? "Submitting…" : `Submit and hold ${selected.length} slot${selected.length === 1 ? "" : "s"}`}</Button>
        {pendingProof && <p className="text-xs text-muted-foreground">Finish each required proof upload before submitting.</p>}
        {unavailable && <p className="text-xs text-destructive">A selected category has no available {intent === "reservation" ? "reservation" : "general"} slots. Choose another category.</p>}
      </section>
      <aside className={`${styles.panel} ${styles.aside}`}><h2>What happens next</h2><ol className={styles.steps}>
        <li><strong>Submit your proof</strong><br />One image per Passport in a category requiring pre-screening.</li>
        <li><strong>All selected slots are held</strong><br />No payment when you submit. Categories without requirements need no review.</li>
        <li><strong>{needsReview ? "Pay after group approval" : "Pay after submission"}</strong><br />We email you when every remaining participant can pay. You then have 72 hours.</li></ol>
        <div className={styles.note}><Info aria-hidden="true" /><p>If one participant is rejected, only their slot is released. They can choose another available category.</p></div><div className={styles.note}><LockKeyhole aria-hidden="true" /><p>Proof stays private. Only the booker and authorized reviewers can view it.</p></div>
        <Link href="/prescreening" className={styles.allRequests}>My requests</Link>
      </aside>
    </div>
  </div></main>;
}
