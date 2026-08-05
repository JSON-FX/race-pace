/** Offline check-in store. Pure — no React, no network, no DOM.
 *  Timestamps and client ids are parameters, never generated here, so every
 *  transition is deterministic under test. Design §5.3–5.5. */

export type RosterRow = {
  registration_id: string;
  ticket_token: string | null;
  runner: string;
  bib: string | null;
  category: string;
  status: string;
  checked_in_at: string | null;
};

export type QueuedScan = {
  clientId: string;
  ticketToken: string;
  registrationId: string;
  runner: string;
  category: string;
  scannedAt: string;
};

export type FailedScan = QueuedScan & { reason: string; httpStatus: number; failedAt: string };

export type CheckInStore = {
  rosterFetchedAt: string | null;
  roster: RosterRow[];
  queue: QueuedScan[];
  failed: FailedScan[];
};

/** Mirrors the check-in Edge Function's response envelope so one mapper renders both paths. */
export type EdgeResult = { status: number; body: any };

export const EMPTY_STORE: CheckInStore = { rosterFetchedAt: null, roster: [], queue: [], failed: [] };

export function storageKey(eventId: string): string {
  return `race-pace.checkin.v1.${eventId}`;
}

export function loadStore(eventId: string): CheckInStore {
  try {
    const raw = localStorage.getItem(storageKey(eventId));
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw) as Partial<CheckInStore>;
    return {
      rosterFetchedAt: parsed.rosterFetchedAt ?? null,
      roster: parsed.roster ?? [],
      queue: parsed.queue ?? [],
      failed: parsed.failed ?? [],
    };
  } catch {
    return EMPTY_STORE;
  }
}

/** Never throws. A full quota must surface as a sync failure, not a silently lost roster. */
export function saveStore(eventId: string, store: CheckInStore): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(storageKey(eventId), JSON.stringify(store));
    return { ok: true };
  } catch {
    return { ok: false, error: "Device storage is full — the roster could not be saved for offline use." };
  }
}

/** Roster matching only. The wrong-event guard runs before this, on both paths. */
export function offlineDecision(token: string, store: CheckInStore): EdgeResult {
  const row = store.roster.find((r) => r.ticket_token !== null && r.ticket_token === token);
  if (!row) return { status: 404, body: { error: "not_found" } };
  if (row.status !== "paid") return { status: 409, body: { error: "not_paid" } };
  const queued = store.queue.some((q) => q.registrationId === row.registration_id);
  if (row.checked_in_at !== null || queued) {
    return { status: 200, body: { ok: true, already: true, registration_id: row.registration_id } };
  }
  return { status: 200, body: { ok: true, registration_id: row.registration_id } };
}

export function enqueue(
  store: CheckInStore, row: RosterRow, ticketToken: string, clientId: string, nowIso: string,
): CheckInStore {
  return {
    ...store,
    queue: [...store.queue, {
      clientId,
      ticketToken,
      registrationId: row.registration_id,
      runner: row.runner,
      category: row.category,
      scannedAt: nowIso,
    }],
  };
}

export function markReplayed(store: CheckInStore, clientId: string, checkedInAtIso: string): CheckInStore {
  const entry = store.queue.find((q) => q.clientId === clientId);
  return {
    ...store,
    queue: store.queue.filter((q) => q.clientId !== clientId),
    roster: entry
      ? store.roster.map((r) =>
          r.registration_id === entry.registrationId ? { ...r, checked_in_at: checkedInAtIso } : r)
      : store.roster,
  };
}

export function markFailed(
  store: CheckInStore, clientId: string, reason: string, httpStatus: number, nowIso: string,
): CheckInStore {
  const entry = store.queue.find((q) => q.clientId === clientId);
  if (!entry) return store;
  return {
    ...store,
    queue: store.queue.filter((q) => q.clientId !== clientId),
    failed: [...store.failed, { ...entry, reason, httpStatus, failedAt: nowIso }],
  };
}

export function retryFailed(store: CheckInStore, clientId: string): CheckInStore {
  const entry = store.failed.find((f) => f.clientId === clientId);
  if (!entry) return store;
  const { reason: _r, httpStatus: _h, failedAt: _f, ...queued } = entry;
  return {
    ...store,
    failed: store.failed.filter((f) => f.clientId !== clientId),
    queue: [...store.queue, queued],
  };
}

/** Derived, never stored — so it stays correct offline and after any replay. */
export function progress(store: CheckInStore): { done: number; total: number } {
  const paid = store.roster.filter((r) => r.status === "paid");
  const queued = new Set(store.queue.map((q) => q.registrationId));
  const done = paid.filter((r) => r.checked_in_at !== null || queued.has(r.registration_id)).length;
  return { done, total: paid.length };
}
