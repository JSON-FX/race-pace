import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rescheduleEvent } from "../lib/eventWrites";

export function RescheduleModal({ event, onClose, onDone }: { event: { id: string; event_date: string | null; end_date: string | null }; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("Enter a date as YYYY-MM-DD"); return; }
    setBusy(true); setError(null);
    const { error } = await rescheduleEvent(event.id, event.event_date, event.end_date, date, note);
    setBusy(false);
    if (error) { setError(error); return; }
    toast.success("Event rescheduled");
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[380px]">
        <DialogHeader>
          <DialogTitle>Reschedule event</DialogTitle>
        </DialogHeader>
        <Input aria-label="New date" placeholder="YYYY-MM-DD" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
        <DialogFooter>
          <Button variant="outline" className="rounded-pill" onClick={onClose}>Cancel</Button>
          <Button className="rounded-pill" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
