import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatAddress, formatDateRange } from "@race-pace/shared";
import { useMyRoles } from "../lib/roles";
import { useOrgEvents, type AdminEventRow } from "../lib/events";
import { useEventRegistrationCounts } from "../lib/registrations";
import { RescheduleModal } from "../components/RescheduleModal";
import { CancelModal } from "../components/CancelModal";

// status enum -> { label, text color, tint bg } — mirrors the handover's statusChip
const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: "var(--ink)", bg: "var(--parchment)" },
  almost_full: { label: "Almost full", color: "var(--amber)", bg: "var(--amber-tint)" },
  cancelled: { label: "Cancelled", color: "var(--danger)", bg: "var(--danger-tint)" },
  rescheduled: { label: "Rescheduled", color: "var(--info)", bg: "var(--info-tint)" },
  completed: { label: "Completed", color: "var(--ink-muted)", bg: "var(--parchment)" },
  closed: { label: "Closed", color: "var(--ink-muted)", bg: "var(--parchment)" },
  draft: { label: "Draft", color: "var(--ink-muted)", bg: "var(--parchment)" },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " "), color: "var(--ink)", bg: "var(--parchment)" };
  return (
    <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", color: s.color, background: s.bg, textTransform: "capitalize" }}>
      {s.label}
    </span>
  );
}

function fill(cats: AdminEventRow["categories"]) {
  const taken = cats.reduce((s, c) => s + c.slots_taken, 0);
  const total = cats.reduce((s, c) => s + c.slots_total, 0);
  return `${taken}/${total}`;
}
function fmtDate(d: string | null) {
  return d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

const GRID = "2.4fr 1.1fr .9fr .8fr .7fr .7fr auto";

export function Events() {
  const roles = useMyRoles();
  const { data, isLoading, isError, refetch } = useOrgEvents(roles.data?.orgId ?? undefined);
  const counts = useEventRegistrationCounts(roles.data?.orgId ?? undefined);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: "reschedule" | "cancel"; ev: AdminEventRow } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["org-events"] });

  if (isLoading) return <Wrap><div style={cardStyle}><div style={{ padding: 20, color: "var(--ink-muted)", fontSize: 14 }}>Loading events…</div></div></Wrap>;
  if (isError) return (
    <Wrap>
      <div style={{ ...cardStyle, padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ color: "var(--ink-muted)", fontSize: 14 }}>Couldn't load events.</span>
        <button onClick={() => refetch()} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-pill)", padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Retry</button>
      </div>
    </Wrap>
  );
  const rows = data ?? [];

  return (
    <Wrap>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={() => nav("/events/new")} style={{ background: "var(--primary)", color: "#fff", fontSize: 13, fontWeight: 600, padding: "10px 18px", borderRadius: "var(--radius-pill)", border: 0, cursor: "pointer" }}>
          + Create event
        </button>
      </div>

      <div style={{ ...cardStyle, overflow: "hidden" }}>
        <div style={{ ...theadStyle, gridTemplateColumns: GRID }}>
          <span>Event</span><span>Date</span><span>Status</span><span>Categories</span><span>Fill</span><span>Regs</span><span></span>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 20, color: "var(--ink-muted)", fontSize: 14, borderTop: "1px solid var(--row-border)" }}>No events yet.</div>
        ) : (
          rows.map((e) => (
            <div key={e.id} style={{ display: "grid", gridTemplateColumns: GRID, padding: "14px 20px", borderTop: "1px solid var(--row-border)", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{e.name}</div>
                {(formatAddress({ city_name: e.city_name, province_name: e.province_name }) || e.place) ? (
                  <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{formatAddress({ city_name: e.city_name, province_name: e.province_name }) || e.place}</div>
                ) : null}
              </div>
              <div style={{ fontSize: 13 }}>
                {e.event_date ? formatDateRange(e.event_date, e.end_date, fmtDate) : "—"}
                {e.original_date ? <span style={{ color: "var(--info)", fontSize: 12 }}> · was {fmtDate(e.original_date)}</span> : null}
              </div>
              <div><StatusChip status={e.status} /></div>
              <div style={{ fontSize: 13 }}>{e.categories.length}</div>
              <div style={{ fontSize: 13 }}>{fill(e.categories)}</div>
              <div style={{ fontSize: 13 }}>{counts.data?.[e.id] ?? 0}</div>
              <div style={{ position: "relative", textAlign: "right" }}>
                <button aria-label={`Actions for ${e.name}`} onClick={() => setMenuId(menuId === e.id ? null : e.id)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--ink-muted)", fontSize: 18 }}>⋯</button>
                {menuId === e.id ? (
                  <div style={{ position: "absolute", right: 0, top: 24, background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 20, minWidth: 140 }}>
                    <button style={menuItem} onClick={() => { setMenuId(null); nav(`/events/${e.id}/edit`); }}>Edit</button>
                    <button style={menuItem} onClick={() => { setMenuId(null); nav(`/registrations?event=${e.id}`); }}>View registrations</button>
                    <button style={menuItem} onClick={() => { setMenuId(null); setModal({ kind: "reschedule", ev: e }); }}>Reschedule</button>
                    <button style={{ ...menuItem, color: "var(--danger)" }} onClick={() => { setMenuId(null); setModal({ kind: "cancel", ev: e }); }}>Cancel event</button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
      {modal?.kind === "reschedule" ? <RescheduleModal event={modal.ev} onClose={() => setModal(null)} onDone={refresh} /> : null}
      {modal?.kind === "cancel" ? <CancelModal event={modal.ev} onClose={() => setModal(null)} onDone={refresh} /> : null}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "26px 30px 40px" }}>{children}</div>;
}
const cardStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)" } as const;
const theadStyle = { display: "grid", padding: "12px 20px", background: "var(--surface)", color: "var(--section)", fontSize: 11, fontWeight: 600, letterSpacing: ".4px", textTransform: "uppercase" } as const;
const menuItem = { display: "block", width: "100%", textAlign: "left", background: "none", border: 0, padding: "9px 14px", fontSize: 13, cursor: "pointer" } as const;
