import type { CategoryDraft } from "../lib/eventWrites";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

const peso = (c: number) => (c / 100).toString();
const cent = (p: string) => Math.round((parseFloat(p) || 0) * 100);
const head = "text-[10px] font-bold tracking-wide text-muted-foreground uppercase pl-0.5";
const GRID = "grid-cols-[1fr_1.4fr_1fr_1fr_1fr_auto]";

export function CategoryEditor({ rows, onChange }: { rows: CategoryDraft[]; onChange: (r: CategoryDraft[]) => void }) {
  const set = (i: number, patch: Partial<CategoryDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { tempId: `t${Date.now()}${rows.length}`, code: "", label: "", distance_km: null, base_price: 0, slots_total: 0 }]);
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Categories</div>
        <Button variant="ghost" size="sm" onClick={add} className="h-auto p-0 text-xs font-semibold text-primary hover:bg-transparent">+ Add</Button>
      </div>
      {rows.length > 0 ? (
        <div className={`mt-3 grid gap-2 ${GRID}`}>
          <span className={head}>Code</span>
          <span className={head}>Label</span>
          <span className={head}>Distance (km)</span>
          <span className={head}>Price (₱)</span>
          <span className={head}>Slots</span>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={r.id ?? r.tempId} className={`grid items-center gap-2 border-t border-border py-2.5 ${GRID}`}>
          <Input aria-label="Category code" placeholder="e.g. 21k" className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]" value={r.code} onChange={(e) => set(i, { code: e.target.value })} />
          <Input aria-label="Category label" placeholder="e.g. 21K Trail Run" className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]" value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
          <Input aria-label="Distance km" placeholder="km" type="number" className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]" value={r.distance_km ?? ""} onChange={(e) => set(i, { distance_km: e.target.value === "" ? null : Number(e.target.value) })} />
          <Input aria-label="Base price" placeholder="₱" type="number" step="0.01" className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]" value={peso(r.base_price)} onChange={(e) => set(i, { base_price: cent(e.target.value) })} />
          <Input aria-label="Slots" placeholder="slots" type="number" className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]" value={r.slots_total} onChange={(e) => set(i, { slots_total: Number(e.target.value) })} />
          <Button aria-label="Remove category" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="h-auto w-auto p-0 text-base text-destructive hover:bg-transparent">×</Button>
        </div>
      ))}
    </Card>
  );
}
