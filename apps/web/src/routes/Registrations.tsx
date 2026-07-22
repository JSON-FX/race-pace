import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMyRoles } from "../lib/roles";
import { useOrgEvents } from "../lib/events";
import { useEventRegistrations, useEventRegistrationCounts, type RegistrationRow } from "../lib/registrations";
import { RegistrationDetail } from "../components/RegistrationDetail";
import { PaymentBadge } from "../components/PaymentBadge";

const PAY_FILTERS = ["all", "pending", "paid", "refunded", "failed"] as const;
const GRID = "2fr 1fr .9fr 1fr .9fr";
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Registrations() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const events = useOrgEvents(orgId);
  const counts = useEventRegistrationCounts(orgId);
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event") ?? events.data?.[0]?.id ?? undefined;

  const regs = useEventRegistrations(eventId);
  const [payFilter, setPayFilter] = useState<(typeof PAY_FILTERS)[number]>("all");
  const [catFilter, setCatFilter] = useState("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<RegistrationRow | null>(null);

  const cats = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of regs.data ?? []) if (r.category_id) m.set(r.category_id, r.category_label ?? r.category_id);
    return [...m.entries()];
  }, [regs.data]);

  const rows = useMemo(() => (regs.data ?? []).filter((r) => {
    if (payFilter !== "all" && r.payment_status !== payFilter) return false;
    if (catFilter !== "all" && r.category_id !== catFilter) return false;
    if (q && !`${r.full_name ?? ""} ${r.bib_name ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [regs.data, payFilter, catFilter, q]);

  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <select aria-label="Event" style={selectStyle} value={eventId ?? ""} onChange={(e) => setParams({ event: e.target.value })}>
          {(events.data ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{counts.data?.[ev.id] != null ? ` (${counts.data[ev.id]})` : ""}</option>)}
        </select>
        <select aria-label="Payment status" style={selectStyle} value={payFilter} onChange={(e) => setPayFilter(e.target.value as (typeof PAY_FILTERS)[number])}>
          {PAY_FILTERS.map((f) => <option key={f} value={f}>{f === "all" ? "All payments" : f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
        </select>
        <select aria-label="Category" style={selectStyle} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {cats.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <input aria-label="Search name" placeholder="Search name…" style={{ ...selectStyle, minWidth: 180 }} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!eventId ? (
        <div style={cardStyle}><div style={emptyStyle}>Pick an event to see its registrations.</div></div>
      ) : regs.isLoading ? (
        <div style={cardStyle}><div style={emptyStyle}>Loading registrations…</div></div>
      ) : (
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ ...theadStyle, gridTemplateColumns: GRID }}>
            <span>Runner</span><span>Category</span><span>Amount</span><span>Payment</span><span>Registered</span>
          </div>
          {rows.length === 0 ? <div style={emptyStyle}>No registrations match.</div> : rows.map((r) => (
            <div key={r.id} role="button" onClick={() => setSelected(r)} style={{ display: "grid", gridTemplateColumns: GRID, padding: "14px 20px", borderTop: "1px solid var(--row-border)", alignItems: "center", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.full_name ?? "—"}</div>
                {r.bib_name ? <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{r.bib_name}</div> : null}
              </div>
              <div style={{ fontSize: 13 }}>{r.category_label ?? "—"}</div>
              <div style={{ fontSize: 13 }}>{peso(r.total_amount)}</div>
              <div><PaymentBadge status={r.payment_status} /></div>
              <div style={{ fontSize: 13 }}>{fmtDate(r.created_at)}</div>
            </div>
          ))}
        </div>
      )}

      {selected ? (
        <RegistrationDetail row={selected} onClose={() => setSelected(null)} onRefunded={() => { setSelected(null); regs.refetch(); counts.refetch(); }} />
      ) : null}
    </div>
  );
}

const cardStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)" } as const;
const theadStyle = { display: "grid", padding: "12px 20px", background: "var(--surface)", color: "var(--section)", fontSize: 11, fontWeight: 600, letterSpacing: ".4px", textTransform: "uppercase" } as const;
const selectStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 11, padding: "9px 12px", fontSize: 13, color: "var(--ink)" } as const;
const emptyStyle = { padding: 20, color: "var(--ink-muted)", fontSize: 14 } as const;
