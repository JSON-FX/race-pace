import type { AddonDraft } from "../lib/eventWrites";

const peso = (c: number) => (c / 100).toString();
const cent = (p: string) => Math.round((parseFloat(p) || 0) * 100);
const inp = { border: "1px solid var(--hairline)", borderRadius: 8, padding: "7px 9px", fontSize: 13, width: "100%" } as const;
const head = { fontSize: 10, fontWeight: 700, letterSpacing: ".3px", color: "var(--ink-muted)", textTransform: "uppercase", paddingLeft: 2 } as const;
const GRID = "1fr 1fr auto";

export function AddonEditor({ rows, onChange }: { rows: AddonDraft[]; onChange: (r: AddonDraft[]) => void }) {
  const set = (i: number, patch: Partial<AddonDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { tempId: `t${Date.now()}${rows.length}`, name: "", price: 0 }]);
  return (
    <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Add-ons</div>
        <button onClick={add} style={{ color: "var(--legacy-primary)", fontSize: 12, fontWeight: 600, background: "none", border: 0, cursor: "pointer" }}>+ Add</button>
      </div>
      {rows.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, marginTop: 12 }}>
          <span style={head}>Name</span>
          <span style={head}>Price (₱)</span>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={r.id ?? r.tempId} style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--row-border)" }}>
          <input aria-label="Add-on name" placeholder="Event singlet" style={inp} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <input aria-label="Add-on price" placeholder="₱" type="number" step="0.01" style={inp} value={peso(r.price)} onChange={(e) => set(i, { price: cent(e.target.value) })} />
          <button aria-label="Remove add-on" onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ color: "var(--danger)", background: "none", border: 0, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      ))}
    </div>
  );
}
