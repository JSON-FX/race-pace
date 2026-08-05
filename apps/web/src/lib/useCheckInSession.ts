import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bannerFor, postCheckIn, useCheckInRoster, type CheckInBanner } from "./checkin";
import {
  EMPTY_STORE, loadStore, saveStore, offlineDecision, enqueue, markReplayed,
  markFailed, retryFailed, progress, type CheckInStore, type EdgeResult,
} from "./checkinQueue";

/** Wires roster + offline queue + Edge Function + connectivity into one surface.
 *  The store is the single source of truth for progress, so it stays correct offline. */
export function useCheckInSession(eventId: string | null) {
  const [store, setStore] = useState<CheckInStore>(EMPTY_STORE);
  const [banner, setBanner] = useState<CheckInBanner | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [storageError, setStorageError] = useState<string | null>(null);
  const storeRef = useRef(store);

  const roster = useCheckInRoster(eventId);

  /** Every mutation goes through here so persistence can never be forgotten. */
  const commit = useCallback((next: CheckInStore) => {
    storeRef.current = next;
    setStore(next);
    if (eventId) {
      const res = saveStore(eventId, next);
      setStorageError(res.ok ? null : res.error ?? null);
    }
  }, [eventId]);

  // Swap to the selected event's persisted store.
  useEffect(() => {
    const next = eventId ? loadStore(eventId) : EMPTY_STORE;
    storeRef.current = next;
    setStore(next);
    setBanner(null);
  }, [eventId]);

  // Fold a fresh roster in without discarding the queue or failed list.
  // The timestamp comes from React Query's dataUpdatedAt — the moment of the last
  // SUCCESSFUL fetch — not `new Date()`. On a cache hit (remount, navigating back
  // from the dashboard) `roster.data`'s identity changes but no fetch happened, and
  // stamping "now" there would tell the marshal "synced just now" over a roster that
  // could be hours old. That honesty guarantee is load-bearing offline — design §7.
  useEffect(() => {
    if (!eventId || !roster.data) return;
    const at = roster.dataUpdatedAt ? new Date(roster.dataUpdatedAt).toISOString() : null;
    commit({ ...storeRef.current, roster: roster.data, rosterFetchedAt: at });
  }, [eventId, roster.data, roster.dataUpdatedAt, commit]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const replayOne = useCallback(async (clientId: string) => {
    const entry = storeRef.current.queue.find((q) => q.clientId === clientId);
    if (!entry) return;
    let res: EdgeResult;
    try {
      res = await postCheckIn(entry.ticketToken);
    } catch {
      return;                                   // still offline — leave it queued
    }
    // The unique(registration_id) constraint makes a duplicate a success, not an error.
    if (res.status === 200 && res.body?.ok) {
      commit(markReplayed(storeRef.current, clientId, new Date().toISOString()));
    } else {
      const b = bannerFor(res, entry.runner, entry.category);
      commit(markFailed(storeRef.current, clientId, b.title, res.status, new Date().toISOString()));
    }
  }, [commit]);

  // Guards against the auto-drain effect below re-entering retryAll while a
  // drain is already in flight: each replayOne commits a shrinking queue,
  // which changes store.queue.length and re-fires the effect mid-loop.
  const draining = useRef(false);
  const retryAll = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      for (const q of [...storeRef.current.queue]) await replayOne(q.clientId);
    } finally {
      draining.current = false;
    }
  }, [replayOne]);

  // Drain automatically when connectivity returns.
  useEffect(() => {
    if (online && store.queue.length > 0) void retryAll();
  }, [online, store.queue.length, retryAll]);

  const submitToken = useCallback(async (token: string) => {
    const current = storeRef.current;
    const decision = offlineDecision(token, current);

    if (!navigator.onLine) {
      const row = current.roster.find((r) => r.ticket_token === token);
      if (decision.status === 200 && decision.body?.ok && !decision.body?.already && row) {
        commit(enqueue(current, row, token, crypto.randomUUID(), new Date().toISOString()));
      }
      setBanner(bannerFor(decision, row?.runner, row?.category));
      return;
    }

    // Online: the SERVER is authoritative — never refuse locally. `offlineDecision`
    // answers "not_found" for anyone who registered on-site after the last roster sync
    // and "not_paid" for anyone who paid on-site after it, both of which the server
    // would accept. Short-circuiting on it here would refuse valid runners at the start
    // line while the network is perfectly fine. The only local pre-check that survives
    // online is the wrong-event guard in CheckIn.tsx, which runs before this.
    const row = current.roster.find((r) => r.ticket_token === token);
    try {
      const res = await postCheckIn(token);
      if (res.status === 200 && res.body?.ok) {
        const stamped = row
          ? { ...storeRef.current, roster: storeRef.current.roster.map((r) =>
              r.registration_id === row.registration_id
                ? { ...r, checked_in_at: r.checked_in_at ?? new Date().toISOString() } : r) }
          : storeRef.current;
        commit(stamped);
      }
      setBanner(bannerFor(res, row?.runner, row?.category));
    } catch {
      // The network died between the check and the post — queue rather than lose it.
      if (row) commit(enqueue(storeRef.current, row, token, crypto.randomUUID(), new Date().toISOString()));
      setBanner(bannerFor(decision, row?.runner, row?.category));
    }
  }, [commit]);

  const retryOne = useCallback(async (clientId: string) => {
    commit(retryFailed(storeRef.current, clientId));
    await replayOne(clientId);
  }, [commit, replayOne]);

  return {
    store,
    banner,
    online,
    storageError,
    progress: useMemo(() => progress(store), [store]),
    rosterFetchedAt: store.rosterFetchedAt,
    rosterSyncing: roster.isFetching,
    rosterError: roster.error ? (roster.error as Error).message : null,
    syncRoster: () => void roster.refetch(),
    submitToken,
    retryOne,
    retryAll,
  };
}
