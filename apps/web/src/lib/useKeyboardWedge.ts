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
        // React installs its own instance-level "value" setter to track the last
        // value it rendered. Assigning `el.value = ...` directly goes through that
        // tracker, so the `input` event we dispatch looks like a no-op to React and
        // `onChange` never fires — the leaked characters would reappear on the next
        // render. Writing through the prototype's setter bypasses the tracker so
        // React sees a real change and updates its controlled state.
        const proto = snapshot.el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(snapshot.el, snapshot.value);
        snapshot.el.dispatchEvent(new Event("input", { bubbles: true }));
        if (snapshot.start !== null) snapshot.el.setSelectionRange(snapshot.start, snapshot.start);
      }
      snapshot = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // OS key auto-repeat (holding a key down) satisfies all three detection
      // signals — sub-30ms gaps, token-charset characters, enough of them — so it
      // must never reach the reducer. Ignoring repeats entirely also leaves any
      // in-progress burst state untouched, which is correct: a repeat is not part
      // of a scanner burst either way.
      if (e.repeat) return;

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
