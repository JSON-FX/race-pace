import type { CategoryDraft } from "../lib/eventWrites";

const peso = (c: number) => (c / 100).toString();
const cent = (p: string) => Math.round((parseFloat(p) || 0) * 100);
const inp = { border: "1px solid var(--hairline)", borderRadius: 8, padding: "7px 9px", fontSize: 13, width: "100%" } as const;
const head = { fontSize: 10, fontWeight: 700, letterSpacing: ".3px", color: "var(--ink-muted)", textTransform: "uppercase", paddingLeft: 2 } as const;
const GRID = "1fr 1.4fr 1fr 1fr 1fr auto";

export function CategoryEditor({ rows, onChange }: { rows: CategoryDraft[]; onChange: (r: CategoryDraft[]) => void }) {
  const set = (i: number, patch: Partial<CategoryDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { tempId: `t${Date.now()}${rows.length}`, code: "", label: "", distance_km: null, base_price: 0, slots_total: 0 }]);
  return (
    <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Categories</div>
        <button onClick={add} style={{ color: "var(--legacy-primary)", fontSize: 12, fontWeight: 600, background: "none", border: 0, cursor: "pointer" }}>+ Add</button>
      </div>
      {rows.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, marginTop: 12 }}>
          <span style={head}>Code</span>
          <span style={head}>Label</span>
          <span style={head}>Distance (km)</span>
          <span style={head}>Price (₱)</span>
          <span style={head}>Slots</span>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={r.id ?? r.tempId} style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--row-border)" }}>
          <input aria-label="Category code" placeholder="e.g. 21k" style={inp} value={r.code} onChange={(e) => set(i, { code: e.target.value })} />
          <input aria-label="Category label" placeholder="e.g. 21K Trail Run" style={inp} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
          <input aria-label="Distance km" placeholder="km" type="number" style={inp} value={r.distance_km ?? ""} onChange={(e) => set(i, { distance_km: e.target.value === "" ? null : Number(e.target.value) })} />
          <input aria-label="Base price" placeholder="₱" type="number" step="0.01" style={inp} value={peso(r.base_price)} onChange={(e) => set(i, { base_price: cent(e.target.value) })} />
          <input aria-label="Slots" placeholder="slots" type="number" style={inp} value={r.slots_total} onChange={(e) => set(i, { slots_total: Number(e.target.value) })} />
          <button aria-label="Remove category" onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ color: "var(--danger)", background: "none", border: 0, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      ))}
    </div>
  );
}
