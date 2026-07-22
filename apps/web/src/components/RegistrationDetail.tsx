import { useState } from "react";
import type { RegistrationRow } from "../lib/registrations";
import { PaymentBadge } from "./PaymentBadge";
import { RefundModal } from "./RefundModal";

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "flex", justifyContent: "flex-end", zIndex: 40 } as const;
const drawer = { width: 420, maxWidth: "100%", height: "100%", background: "var(--canvas)", padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 } as const;
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
      <span style={{ color: "var(--ink-muted)" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function RegistrationDetail({ row, onClose, onRefunded }: { row: RegistrationRow; onClose: () => void; onRefunded: () => void }) {
  const [refunding, setRefunding] = useState(false);
  const canRefund = row.payment_status === "paid";
  const customEntries = Object.entries(row.custom_data ?? {});
  return (
    <div style={overlay} onClick={onClose}>
      <aside style={drawer} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{row.full_name ?? "—"}</div>
            {row.bib_name ? <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>{row.bib_name}</div> : null}
          </div>
          <button aria-label="Close" onClick={onClose} style={{ background: "none", border: 0, fontSize: 20, cursor: "pointer", color: "var(--ink-muted)" }}>×</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <Row label="Category" value={row.category_label ?? "—"} />
          <Row label="Amount" value={peso(row.total_amount)} />
          <Row label="Payment" value={<PaymentBadge status={row.payment_status} />} />
          {row.payment_method ? <Row label="Method" value={row.payment_method} /> : null}
          <Row label="Registered" value={fmtDate(row.created_at)} />
        </div>
        {row.addons.length ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".4px", color: "var(--section)", textTransform: "uppercase", marginBottom: 6 }}>Add-ons</div>
            {row.addons.map((a, i) => <Row key={i} label={a.name ?? "—"} value={peso(a.price)} />)}
          </div>
        ) : null}
        {customEntries.length ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".4px", color: "var(--section)", textTransform: "uppercase", marginBottom: 6 }}>Registration fields</div>
            {customEntries.map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
          </div>
        ) : null}
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
          <button disabled={!canRefund} onClick={() => setRefunding(true)} style={{ background: canRefund ? "var(--danger)" : "var(--surface)", color: canRefund ? "#fff" : "var(--ink-muted)", border: 0, borderRadius: "var(--radius-pill)", padding: "9px 20px", fontWeight: 600, cursor: canRefund ? "pointer" : "default" }}>
            {row.payment_status === "refunded" ? "Refunded" : "Refund"}
          </button>
        </div>
        {refunding ? (
          <RefundModal
            registration={{ id: row.id, full_name: row.full_name, total_amount: row.total_amount }}
            onClose={() => setRefunding(false)}
            onDone={onRefunded}
          />
        ) : null}
      </aside>
    </div>
  );
}
