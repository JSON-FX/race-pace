import { useState } from "react";
import { rescheduleEvent } from "../lib/eventWrites";

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "grid", placeItems: "center", zIndex: 50 } as const;
const box = { width: 380, background: "var(--canvas)", borderRadius: 16, padding: 24 } as const;
const input = { border: "1px solid var(--hairline)", borderRadius: 11, padding: "12px 13px", fontSize: 14, width: "100%" } as const;

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
    if (error) setError(error); else { onDone(); onClose(); }
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Reschedule event</div>
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <input aria-label="New date" placeholder="YYYY-MM-DD" style={input} value={date} onChange={(e) => setDate(e.target.value)} />
          <input aria-label="Note" placeholder="Note (optional)" style={input} value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-pill)", padding: "9px 18px", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={submit} disabled={busy} style={{ background: "var(--primary)", color: "#fff", border: 0, borderRadius: "var(--radius-pill)", padding: "9px 20px", fontWeight: 600, cursor: "pointer" }}>{busy ? "Saving…" : "Reschedule"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
