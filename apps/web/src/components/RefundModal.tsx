import { useState } from "react";
import { refundRegistration } from "../lib/registrations";

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "grid", placeItems: "center", zIndex: 50 } as const;
const box = { width: 380, background: "var(--canvas)", borderRadius: 16, padding: 24 } as const;
const input = { border: "1px solid var(--hairline)", borderRadius: 11, padding: "12px 13px", fontSize: 14, width: "100%" } as const;

export function RefundModal({ registration, onClose, onDone }: {
  registration: { id: string; full_name: string | null; total_amount: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    const res = await refundRegistration(registration.id, note || undefined);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Refund failed."); else { onDone(); onClose(); }
  }
  const peso = `₱${(registration.total_amount / 100).toLocaleString()}`;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Refund {peso}?</div>
        <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>Refunds {registration.full_name ?? "this runner"} and reopens their slot. This can't be undone.</p>
        <div style={{ display: "grid", gap: 12 }}>
          <input aria-label="Refund note" placeholder="Reason (optional)" style={input} value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-pill)", padding: "9px 18px", fontWeight: 600, cursor: "pointer" }}>Keep it</button>
            <button aria-label="Confirm refund" onClick={submit} disabled={busy} style={{ background: "var(--danger)", color: "#fff", border: 0, borderRadius: "var(--radius-pill)", padding: "9px 20px", fontWeight: 600, cursor: "pointer" }}>{busy ? "Refunding…" : "Refund"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
