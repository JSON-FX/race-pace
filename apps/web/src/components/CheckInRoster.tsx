import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import type { RosterRow } from "../lib/checkinQueue";

/** Tapping a runner submits THEIR stored ticket_token through the same pipeline as a
 *  scan, so there is no second backend path for the dead-phone case. Design §7. */
export function CheckInRoster({
  roster, queuedIds, onCheckIn,
}: {
  roster: RosterRow[];
  queuedIds: Set<string>;
  onCheckIn: (token: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((r) =>
      r.runner.toLowerCase().includes(needle) || (r.bib ?? "").toLowerCase().includes(needle));
  }, [roster, q]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Input placeholder="Search by name or bib…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {roster.length === 0 ? (
          // Pre-sync state, not a failed search — the offline path depends on the
          // marshal noticing this rather than reading it as "no results for ''".
          <li className="p-6 text-center text-sm text-muted-foreground">
            Roster not downloaded yet — tap Sync roster.
          </li>
        ) : filtered.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">No runner matches “{q}”.</li>
        ) : filtered.map((r) => {
          const done = r.checked_in_at !== null || queuedIds.has(r.registration_id);
          return (
            <li key={r.registration_id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.runner}</div>
                <div className="text-xs text-muted-foreground">
                  {[r.bib, r.category].filter(Boolean).join(" · ")}
                </div>
              </div>
              {r.status !== "paid" ? (
                <Badge variant="outline">Not paid</Badge>
              ) : done ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                  <Check className="size-4" /> Checked in
                </span>
              ) : (
                <Button
                  size="sm"
                  aria-label={`Check in ${r.runner}`}
                  disabled={!r.ticket_token}
                  onClick={() => r.ticket_token && onCheckIn(r.ticket_token)}
                >
                  Check in
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
