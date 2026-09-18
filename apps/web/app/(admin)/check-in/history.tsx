"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type HistoryRow = { id: string; runner: string; action: string; actor_id: string | null; actor_role: string | null; created_at: string };

export function CheckInHistory({ eventId, revision }: { eventId: string; revision: number }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    createClient().rpc("checkin_history", { p_event_id: eventId }).limit(50)
      .then(({ data, error }) => {
        if (cancelled) return;
        setRows((data ?? []) as HistoryRow[]);
        setState(error ? "error" : "ready");
      });
    return () => { cancelled = true; };
  }, [eventId, revision, retry]);
  return (
    <Card className="mt-4 gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Check-in history</h2>
        <Button variant="outline" size="sm" onClick={() => setRetry(n => n + 1)}>Refresh history</Button>
      </div>
      <p className="text-xs text-muted-foreground">Latest 50 actions. Reversing a check-in keeps its history.</p>
      {state === "loading" ? <p role="status">Loading history…</p> : state === "error" ? <p role="alert">Couldn’t load check-in history. Try refreshing.</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No recorded check-in actions yet.</p> : (
        <ul className="divide-y">
          {rows.map(row => <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
            <div><p className="font-medium">{row.runner} · {row.action === "checked_in" ? "Checked in" : "Check-in reversed"}</p>
              <p className="break-all text-xs text-muted-foreground">{row.actor_role?.replaceAll("_", " ") ?? "Staff"} · {row.actor_id ?? "Unknown actor"}</p></div>
            <time className="text-xs text-muted-foreground" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
          </li>)}
        </ul>
      )}
    </Card>
  );
}
