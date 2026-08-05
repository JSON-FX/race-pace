/** Hardware QR scanners in HID mode present as keyboards. Detecting them on
 *  timing alone false-positives on fast typists, so this uses three signals:
 *  sub-30ms gaps, a buffer matching the ticket-token charset, and a terminator.
 *  Pure — no DOM, so the whole truth table is testable. Design §6.2. */

export type WedgeState = { buffer: string; lastAt: number; fastCount: number };
export type WedgeEvent = { key: string; timeStamp: number; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };
export type WedgeResult = { state: WedgeState; emit?: string; capture: boolean };

export const WEDGE_INIT: WedgeState = { buffer: "", lastAt: 0, fastCount: 0 };

export const MAX_GAP_MS = 30;
export const IDLE_COMMIT_MS = 80;
export const MIN_TOKEN_LEN = 8;

/** base64url plus the '.' separating the ticket body from its signature. */
const TOKEN_CHAR = /^[A-Za-z0-9_.-]$/;

/** A HID scanner IS a keyboard: the browser emits a `Shift` keydown before every
 *  uppercase character, and ticket tokens are base64url — full of uppercase. These
 *  keys carry no character and must leave the burst state completely untouched,
 *  otherwise the buffer resets mid-token and the marshal sees "Invalid ticket" for
 *  a perfectly valid ticket. Genuine navigation/control keys (Escape, Tab, arrows,
 *  Backspace …) still fall through to the charset check and reset the buffer. */
const IGNORED_KEYS = new Set([
  "Shift", "CapsLock", "Control", "Alt", "Meta", "AltGraph",
  "Dead", "Unidentified", "NumLock", "ScrollLock", "OS", "Hyper", "Super", "Fn", "FnLock",
]);

function isScan(s: WedgeState): boolean {
  return s.buffer.length >= MIN_TOKEN_LEN && s.fastCount >= 2;
}

export function feedKey(state: WedgeState, ev: WedgeEvent): WedgeResult {
  // Checked BEFORE the modifier-combo guard: a bare `Control`/`Alt`/`Meta` keydown
  // sets its own modifier flag, so it would otherwise be read as a shortcut and
  // wipe an in-flight burst. `Ctrl+a` (key "a", ctrlKey true) still resets below.
  if (IGNORED_KEYS.has(ev.key)) return { state, capture: false };

  if (ev.ctrlKey || ev.metaKey || ev.altKey) return { state: WEDGE_INIT, capture: false };

  // A gap longer than the idle window means the previous burst is over.
  const stale = state.buffer !== "" && ev.timeStamp - state.lastAt > IDLE_COMMIT_MS;
  const base = stale ? WEDGE_INIT : state;

  if (ev.key === "Enter") {
    const scan = isScan(base);
    return { state: WEDGE_INIT, emit: scan ? base.buffer : undefined, capture: scan };
  }

  if (!TOKEN_CHAR.test(ev.key)) return { state: WEDGE_INIT, capture: false };

  const fast = base.buffer === "" || ev.timeStamp - base.lastAt <= MAX_GAP_MS;
  if (!fast) {
    // Human speed — this character starts a fresh candidate burst.
    return { state: { buffer: ev.key, lastAt: ev.timeStamp, fastCount: 0 }, capture: false };
  }

  const next: WedgeState = {
    buffer: base.buffer + ev.key,
    lastAt: ev.timeStamp,
    fastCount: base.buffer === "" ? 0 : base.fastCount + 1,
  };
  return { state: next, capture: next.fastCount >= 2 };
}

/** Called by the DOM binding after IDLE_COMMIT_MS of silence, for scanners with no Enter suffix. */
export function commitIdle(state: WedgeState): WedgeResult {
  const scan = isScan(state);
  return { state: WEDGE_INIT, emit: scan ? state.buffer : undefined, capture: false };
}
