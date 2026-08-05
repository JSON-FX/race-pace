import { useEffect, useRef } from "react";
import { commitIdle, feedKey, IDLE_COMMIT_MS, WEDGE_INIT, type WedgeState } from "./keyboardWedge";

type Editable = HTMLInputElement | HTMLTextAreaElement;

function editable(el: EventTarget | null): Editable | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return null;
}

/** Binds the wedge reducer to capture-phase keydown so a scanner burst wins over
 *  whatever has focus. Snapshots the focused field at burst start and restores it
 *  on a successful scan, undoing the one or two characters that leak before
 *  detection triggers. On a burst that turns out NOT to be a scan the snapshot is
 *  discarded — those characters were real typing. Design §6.2. */
export function useKeyboardWedge(onScan: (token: string) => void, enabled: boolean): void {
  const scan = useRef(onScan);
  scan.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let state: WedgeState = WEDGE_INIT;
    let snapshot: { el: Editable; value: string; start: number | null } | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;

    const restore = () => {
      if (snapshot && snapshot.el.isConnected && snapshot.el.value !== snapshot.value) {
        snapshot.el.value = snapshot.value;
        snapshot.el.dispatchEvent(new Event("input", { bubbles: true }));
        if (snapshot.start !== null) snapshot.el.setSelectionRange(snapshot.start, snapshot.start);
      }
      snapshot = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Snapshot before the reducer sees the key that starts a burst.
      if (state.buffer === "" && snapshot === null) {
        const el = editable(document.activeElement);
        if (el) snapshot = { el, value: el.value, start: el.selectionStart };
      }

      const res = feedKey(state, {
        key: e.key, timeStamp: e.timeStamp,
        ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
      });
      state = res.state;

      if (res.capture) {
        e.preventDefault();
        e.stopPropagation();
      }

      clearTimeout(idle);
      if (res.emit) {
        restore();
        scan.current(res.emit);
        return;
      }
      if (state.buffer === "") {
        snapshot = null;                      // burst abandoned — real typing stays
        return;
      }
      idle = setTimeout(() => {
        const done = commitIdle(state);
        state = done.state;
        if (done.emit) {
          restore();
          scan.current(done.emit);
        } else {
          snapshot = null;
        }
      }, IDLE_COMMIT_MS);
    };

    document.addEventListener("keydown", onKeyDown, true);   // capture phase
    return () => {
      clearTimeout(idle);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [enabled]);
}
