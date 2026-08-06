"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterRoster, type RosterRow } from "@/lib/checkin";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** HH:MM for the check-in column. Built from the Date directly rather than
 *  toLocaleTimeString for the same ICU reason fmtDateTime gives: `hour12:
 *  false` renders midnight as "24:00" in some environments, and a 00:xx
 *  start time is exactly when an ultra begins. */
export function hhmm(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function RunnerCell({ row, meta }: { row: RosterRow; meta: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="size-6 rounded-[7px]">
        <AvatarFallback className="rounded-[7px] bg-forest text-[9.5px] font-bold text-white">
          {initials(row.runner)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-semibold">{row.runner}</div>
        <div className="truncate text-[11px] text-muted-foreground">{meta}</div>
      </div>
    </div>
  );
}

/** Search box + category chips. Both filter client-side over rows already in
 *  memory (see filterRoster) — instant, and no round trip on a connection
 *  that may be barely alive at a mountain start line. */
function Filters({
  q, onQ, category, onCategory, categories, label,
}: {
  q: string; onQ: (v: string) => void;
  category: string; onCategory: (v: string) => void;
  categories: string[]; label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[7px] border-b px-3.5 py-2.5">
      <div className="flex min-w-[130px] flex-1 items-center gap-[7px] rounded-lg border bg-muted px-2.5 py-1.5">
        <Search className="size-[13px] shrink-0 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Search name or bib"
          aria-label={label}
          className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      {["all", ...categories].map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onCategory(c)}
          aria-pressed={category === c}
          className={cn(
            "cursor-pointer rounded-pill border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
            category === c
              ? "border-forest bg-forest text-white"
              : "bg-card text-foreground hover:bg-muted",
          )}
        >
          {c === "all" ? "All" : c}
        </button>
      ))}
    </div>
  );
}

export type RosterProps = {
  pending: RosterRow[];
  done: RosterRow[];
  categories: string[];
  /** Which registrations are mid-request — the row's button shows a spinner
   *  state rather than letting a marshal double-fire a scan on a slow link. */
  busy: Set<string>;
  /** Source label ("Scanner" / "Camera" / "Manual") for rows checked in
   *  during THIS session. The DB does not record how a check-in happened, so
   *  this is deliberately absent for rows that were already in when the page
   *  loaded — better a blank than a guess that reads as recorded fact. */
  sources: Record<string, string>;
  onCheckIn: (row: RosterRow) => void;
  onUndo: (row: RosterRow) => void;
};

/**
 * The two tables under the scan bar. Manual tap is the third input and the
 * only one that works with no hardware at all — a dead phone, a cracked
 * screen, a runner who never opened the app. It is always available, not a
 * mode you switch into.
 *
 * An unpaid entry renders as "Blocked" and disabled. That is not a rule this
 * component invents: the check-in Edge Function already returns `not_paid`
 * (409) and refuses the insert, so the row is reflecting a decision the
 * server enforces regardless of what the UI allows.
 */
export function Roster({ pending, done, categories, busy, sources, onCheckIn, onUndo }: RosterProps) {
  const [pendingQ, setPendingQ] = useState("");
  const [pendingCat, setPendingCat] = useState("all");
  const [doneQ, setDoneQ] = useState("");
  const [doneCat, setDoneCat] = useState("all");

  const pendingRows = useMemo(
    () => filterRoster(pending, pendingQ, pendingCat),
    [pending, pendingQ, pendingCat],
  );
  const doneRows = useMemo(() => filterRoster(done, doneQ, doneCat), [done, doneQ, doneCat]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1.32fr_1fr]">
      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        <div className="flex items-center gap-2.5 border-b px-3.5 py-[11px]">
          <b className="text-[13.5px] font-bold tracking-[-0.01em]">Not yet checked in</b>
          <span className="text-[11.5px] font-semibold text-muted-foreground">
            {pending.length} {pending.length === 1 ? "runner" : "runners"}
          </span>
        </div>
        <Filters
          q={pendingQ} onQ={setPendingQ} category={pendingCat} onCategory={setPendingCat}
          categories={categories} label="Search runners not yet checked in"
        />
        <Table className="text-[12.5px]">
          <TableHeader>
            <TableRow>
              <TableHead>Runner</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendingRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {pending.length === 0 ? "Everyone is in." : "No runner matches that search."}
                </TableCell>
              </TableRow>
            ) : (
              pendingRows.map((row) => {
                const blocked = row.status !== "paid";
                return (
                  <TableRow key={row.registration_id}>
                    <TableCell><RunnerCell row={row} meta={row.bib ? `Bib ${row.bib}` : "No bib"} /></TableCell>
                    <TableCell>{row.category || "—"}</TableCell>
                    <TableCell>
                      <StatusBadge tone={blocked ? "pending" : "paid"}>
                        {blocked ? "Unpaid" : "Paid"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      {blocked ? (
                        <Button
                          size="xs" variant="outline" disabled
                          title="The check-in function refuses an unpaid registration (not_paid, 409). Take payment first."
                        >
                          Blocked
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          onClick={() => onCheckIn(row)}
                          disabled={busy.has(row.registration_id)}
                        >
                          {busy.has(row.registration_id) ? "Checking in…" : "Check in"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        <div className="flex items-center gap-2.5 border-b px-3.5 py-[11px]">
          <b className="text-[13.5px] font-bold tracking-[-0.01em]">Recently checked in</b>
          <span className="text-[11.5px] font-semibold text-muted-foreground">{done.length} total</span>
        </div>
        <Filters
          q={doneQ} onQ={setDoneQ} category={doneCat} onCategory={setDoneCat}
          categories={categories} label="Search runners already checked in"
        />
        <Table className="text-[12.5px]">
          <TableHeader>
            <TableRow>
              <TableHead>Runner</TableHead>
              <TableHead>Cat</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {doneRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {done.length === 0 ? "Nobody has checked in yet." : "No runner matches that search."}
                </TableCell>
              </TableRow>
            ) : (
              doneRows.map((row) => (
                <TableRow key={row.registration_id}>
                  <TableCell>
                    <RunnerCell row={row} meta={sources[row.registration_id] ?? (row.bib ? `Bib ${row.bib}` : "")} />
                  </TableCell>
                  <TableCell>{row.category || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{hhmm(row.checked_in_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="xs" variant="outline"
                      onClick={() => onUndo(row)}
                      disabled={busy.has(row.registration_id)}
                    >
                      {busy.has(row.registration_id) ? "…" : "Undo"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
