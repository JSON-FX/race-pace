import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useCheckInEvents, decodeTicketEventId, wrongEventBanner } from "../lib/checkin";
import { useCheckInSession } from "../lib/useCheckInSession";
import { useKeyboardWedge } from "../lib/useKeyboardWedge";
import { QrScanner } from "../components/QrScanner";
import { CheckInBanner } from "../components/CheckInBanner";
import { CheckInRoster } from "../components/CheckInRoster";
import { CheckInQueueStatus } from "../components/CheckInQueueStatus";

const EVENT_KEY = "race-pace.checkin.v1.selected-event";

function syncedLabel(at: string | null): string {
  if (!at) return "Roster not synced yet";
  const mins = Math.floor((Date.now() - new Date(at).getTime()) / 60000);
  if (mins < 1) return "Roster synced just now";
  if (mins < 60) return `Roster synced ${mins} min ago`;
  return `Roster synced ${Math.floor(mins / 60)} h ago`;
}

export function CheckIn() {
  const events = useCheckInEvents();
  const [eventId, setEventId] = useState<string | null>(() => localStorage.getItem(EVENT_KEY));
  const [wrongEvent, setWrongEvent] = useState<string | null>(null);

  // Auto-select when there is exactly one, and drop a stale persisted id.
  useEffect(() => {
    const list = events.data;
    if (!list) return;
    if (eventId && !list.some((e) => e.id === eventId)) { setEventId(null); localStorage.removeItem(EVENT_KEY); return; }
    const only = list.length === 1 ? list[0] : undefined;
    if (!eventId && only) { setEventId(only.id); localStorage.setItem(EVENT_KEY, only.id); }
  }, [events.data, eventId]);

  const session = useCheckInSession(eventId);
  const selected = events.data?.find((e) => e.id === eventId) ?? null;

  const submit = (token: string) => {
    setWrongEvent(null);
    const tokenEvent = decodeTicketEventId(token);
    if (eventId && tokenEvent && tokenEvent !== eventId) {
      const other = events.data?.find((e) => e.id === tokenEvent);
      setWrongEvent(other?.name ?? "another event");
      return;
    }
    void session.submitToken(token);
  };

  useKeyboardWedge(submit, !!eventId);

  const queuedIds = useMemo(
    () => new Set(session.store.queue.map((q) => q.registrationId)),
    [session.store.queue],
  );

  // A marshal must not wander off with unsent check-ins sitting in this tab.
  const unsent = session.store.queue.length + session.store.failed.length;
  useEffect(() => {
    if (unsent === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  const banner = wrongEvent ? wrongEventBanner(wrongEvent) : session.banner;

  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">Check-in</h1>
        {session.online ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Wifi className="size-4" /> Online</span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><CloudOff className="size-4" /> Offline — scans are queued</span>
        )}
        <Select
          value={eventId ?? ""}
          onValueChange={(v) => { setEventId(v); localStorage.setItem(EVENT_KEY, v); }}
        >
          <SelectTrigger className="w-[260px]"><SelectValue placeholder="Choose an event" /></SelectTrigger>
          <SelectContent>
            {(events.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </header>

      {!eventId ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          {events.isLoading ? "Loading events…"
            : (events.data ?? []).length === 0 ? "You are not assigned to any event yet. Ask an organizer to add you."
            : "Choose an event to begin checking runners in."}
        </CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm">
            <span className={session.rosterFetchedAt ? "font-medium" : "font-bold text-amber-600"}>
              {syncedLabel(session.rosterFetchedAt)}
            </span>
            <span className="text-muted-foreground">· {session.store.roster.length} runners</span>
            <span className="ml-auto font-semibold">{session.progress.done} / {session.progress.total} checked in</span>
            <Button size="sm" variant="secondary" onClick={session.syncRoster} disabled={session.rosterSyncing}>
              <RefreshCw className={session.rosterSyncing ? "size-4 animate-spin" : "size-4"} /> Sync roster
            </Button>
          </div>

          {session.storageError ? (
            <div className="rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
              {session.storageError}
            </div>
          ) : null}

          <CheckInQueueStatus
            queue={session.store.queue} failed={session.store.failed} online={session.online}
            onRetryAll={() => void session.retryAll()} onRetryOne={(id) => void session.retryOne(id)}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <QrScanner onScan={submit} />
              <CheckInBanner banner={banner} />
            </div>
            <CheckInRoster roster={session.store.roster} queuedIds={queuedIds} onCheckIn={submit} />
          </div>
        </>
      )}
    </div>
  );
}
