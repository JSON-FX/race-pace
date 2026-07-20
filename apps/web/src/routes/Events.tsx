import { useMyRoles } from "../lib/roles";
import { useOrgEvents, type AdminEventRow } from "../lib/events";

const STATUS_COLOR: Record<string, string> = {
  open: "var(--ink)", almost_full: "var(--amber)", cancelled: "var(--danger)",
  closed: "var(--ink-muted)", completed: "var(--ink-muted)", draft: "var(--ink-subtle)",
};

function fill(cats: AdminEventRow["categories"]) {
  const taken = cats.reduce((s, c) => s + c.slots_taken, 0);
  const total = cats.reduce((s, c) => s + c.slots_total, 0);
  return `${taken}/${total}`;
}
function fmtDate(d: string | null) {
  return d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function Events() {
  const roles = useMyRoles();
  const { data, isLoading, isError, refetch } = useOrgEvents(roles.data?.orgId ?? undefined);

  if (isLoading) return <Wrap><p style={{ color: "var(--ink-muted)" }}>Loading events…</p></Wrap>;
  if (isError) return <Wrap><button onClick={() => refetch()}>Couldn't load events. Retry.</button></Wrap>;
  const rows = data ?? [];

  return (
    <Wrap>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginTop: 0 }}>Events</h1>
      {rows.length === 0 ? (
        <p style={{ color: "var(--ink-muted)" }}>No events yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--canvas)", borderRadius: 12, overflow: "hidden" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-muted)", fontSize: 12 }}>
              <th style={th}>Name</th><th style={th}>Date</th><th style={th}>Status</th><th style={th}>Categories</th><th style={th}>Fill</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid var(--divider)" }}>
                <td style={td}>{e.name}</td>
                <td style={td}>{fmtDate(e.event_date)}{e.original_date ? <span style={{ color: "var(--info)", fontSize: 12 }}> · was {fmtDate(e.original_date)}</span> : null}</td>
                <td style={{ ...td, color: STATUS_COLOR[e.status] ?? "var(--ink)", textTransform: "capitalize" }}>{e.status.replace("_", " ")}</td>
                <td style={td}>{e.categories.length}</td>
                <td style={td}>{fill(e.categories)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 28 }}>{children}</div>;
}
const th = { padding: "12px 14px", fontWeight: 600 } as const;
const td = { padding: "12px 14px", fontSize: 14 } as const;
