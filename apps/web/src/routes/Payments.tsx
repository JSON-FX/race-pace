import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMyRoles } from "../lib/roles";
import { usePayments } from "../lib/registrations";
import { PaymentStatusBadge } from "../components/StatusBadge";

const FILTERS = ["all", "pending", "paid", "refunded", "failed"] as const;
const GRID = "1.4fr 1.4fr .9fr .8fr .8fr .9fr .9fr .9fr";
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Payments() {
  const roles = useMyRoles();
  const pays = usePayments(roles.data?.orgId ?? undefined);
  const nav = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const rows = useMemo(() => (pays.data ?? []).filter((p) => filter === "all" || p.status === filter), [pays.data, filter]);

  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <div style={{ marginBottom: 16 }}>
        <select aria-label="Payment status" style={selectStyle} value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])}>
          {FILTERS.map((f) => <option key={f} value={f}>{f === "all" ? "All payments" : f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
        </select>
      </div>
      <div style={{ ...cardStyle, overflow: "hidden" }}>
        <div style={{ ...theadStyle, gridTemplateColumns: GRID }}>
          <span>Event</span><span>Runner</span><span>Amount</span><span>Fee</span><span>Net</span><span>Method</span><span>Status</span><span>Date</span>
        </div>
        {pays.isLoading ? <div style={emptyStyle}>Loading payments…</div> :
         rows.length === 0 ? <div style={emptyStyle}>No payments yet.</div> :
         rows.map((p) => (
          <div key={p.registration_id} role="button" onClick={() => p.event_id && nav(`/registrations?event=${p.event_id}`)} style={{ display: "grid", gridTemplateColumns: GRID, padding: "14px 20px", borderTop: "1px solid var(--row-border)", alignItems: "center", cursor: "pointer" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.event_name ?? "—"}</div>
            <div style={{ fontSize: 13 }}>{p.full_name ?? "—"}</div>
            <div style={{ fontSize: 13 }}>{peso(p.amount)}</div>
            <div style={{ fontSize: 13 }}>{peso(p.platform_fee)}</div>
            <div style={{ fontSize: 13 }}>{peso(p.net_to_org)}</div>
            <div style={{ fontSize: 13 }}>{p.method ?? "—"}</div>
            <div><PaymentStatusBadge status={p.status} /></div>
            <div style={{ fontSize: 13 }}>{fmtDate(p.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const cardStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)" } as const;
const theadStyle = { display: "grid", padding: "12px 20px", background: "var(--surface)", color: "var(--section)", fontSize: 11, fontWeight: 600, letterSpacing: ".4px", textTransform: "uppercase" } as const;
const selectStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 11, padding: "9px 12px", fontSize: 13, color: "var(--ink)" } as const;
const emptyStyle = { padding: 20, color: "var(--ink-muted)", fontSize: 14 } as const;
