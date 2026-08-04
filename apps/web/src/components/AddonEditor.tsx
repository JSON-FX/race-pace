import type { AddonDraft } from "../lib/eventWrites";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

const peso = (c: number) => (c / 100).toString();
const cent = (p: string) => Math.round((parseFloat(p) || 0) * 100);
const head = "text-[10px] font-bold tracking-wide text-muted-foreground uppercase pl-0.5";
const GRID = "1fr 1fr auto";

export function AddonEditor({ rows, onChange }: { rows: AddonDraft[]; onChange: (r: AddonDraft[]) => void }) {
  const set = (i: number, patch: Partial<AddonDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { tempId: `t${Date.now()}${rows.length}`, name: "", price: 0 }]);
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Add-ons</div>
        <Button variant="ghost" size="sm" onClick={add} className="h-auto p-0 text-xs font-semibold text-primary hover:bg-transparent">+ Add</Button>
      </div>
      {rows.length > 0 ? (
        <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: GRID }}>
          <span className={head}>Name</span>
          <span className={head}>Price (₱)</span>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={r.id ?? r.tempId} className="grid items-center gap-2 border-t border-border py-2.5" style={{ gridTemplateColumns: GRID }}>
          <Input aria-label="Add-on name" placeholder="Event singlet" className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <Input aria-label="Add-on price" placeholder="₱" type="number" step="0.01" className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]" value={peso(r.price)} onChange={(e) => set(i, { price: cent(e.target.value) })} />
          <Button aria-label="Remove add-on" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="h-auto w-auto p-0 text-base text-destructive hover:bg-transparent">×</Button>
        </div>
      ))}
    </Card>
  );
}
