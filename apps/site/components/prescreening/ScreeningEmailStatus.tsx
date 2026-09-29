"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import styles from "./screening.module.css";

type Delivery = { id: string; type: string; sent_at: string | null; attempts: number; last_error: string | null };
export function ScreeningEmailStatus({ batchId, payable }: { batchId: string; payable: boolean }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => { const timer = setInterval(() => setRevision(value => value + 1), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    void createClient().rpc("prescreening_email_status", { p_batch: batchId }).then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage("Email delivery status is unavailable. Your request and deadline are unchanged.");
      else setDeliveries(data ?? []);
    });
    return () => { active = false; };
  }, [batchId, revision, payable]);
  async function resend() {
    setBusy(true); setMessage(null);
    const { error } = await createClient().rpc("prescreening_resend_email", { p_batch: batchId });
    setMessage(error ? error.message.includes("email_retry_later") ? "Wait five minutes between email requests." : "The email could not be queued. Check this request’s current payment status." : "Email queued. The original payment deadline stays the same.");
    setBusy(false); setRevision(value => value + 1);
  }
  const failure = deliveries.some(delivery => !delivery.sent_at && delivery.last_error);
  return <Collapsible className={styles.email} open={expanded || failure || !!message} onOpenChange={setExpanded}>
    <CollapsibleTrigger className="flex items-center justify-between gap-2 text-xs font-semibold">Email updates{failure ? " · Delivery needs attention" : ""}<ChevronDown aria-hidden="true" className="size-4" /></CollapsibleTrigger>
    <CollapsibleContent className={`${styles.emailContent} space-y-2`}>
    {deliveries.map(delivery => <p key={delivery.id} role={delivery.last_error ? "alert" : undefined} className={delivery.last_error ? "text-destructive" : "text-muted-foreground"}>
      {delivery.type === "prescreening_submitted" ? "Request confirmation" : delivery.type === "prescreening_ready" ? "Payment invitation" : "Review decision"}: {delivery.sent_at ? "sent" : delivery.last_error ? delivery.attempts >= 5 ? "delivery failed" : "delivery delayed; retrying" : "queued"}.
    </p>)}
    {!deliveries.length && <p className="text-muted-foreground">No email updates yet.</p>}
    {payable && <Button size="sm" variant="outline" disabled={busy} onClick={() => void resend()}>{busy ? "Queuing…" : "Resend payment email"}</Button>}
    {message && <p role="status">{message}</p>}
    <p className="text-muted-foreground">Email delivery never changes held slots or payment deadlines.</p>
  </CollapsibleContent></Collapsible>;
}
