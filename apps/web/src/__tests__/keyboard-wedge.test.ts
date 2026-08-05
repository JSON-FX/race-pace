import { describe, it, expect, vi } from "vitest";
import { feedKey, commitIdle, WEDGE_INIT, IDLE_COMMIT_MS, type WedgeState } from "../lib/keyboardWedge";
import { render, renderHook } from "@testing-library/react";
import { createElement, useState, type ChangeEvent } from "react";
import { useKeyboardWedge } from "../lib/useKeyboardWedge";

/** Feed a string at a fixed inter-key gap, returning the final result. */
function type(text: string, gapMs: number, start = 1000, state: WedgeState = WEDGE_INIT) {
  let s = state;
  let last: ReturnType<typeof feedKey> = { state: s, capture: false };
  let t = start;
  for (const key of text) {
    last = feedKey(s, { key, timeStamp: t });
    s = last.state;
    t += gapMs;
  }
  return { last, state: s, nextAt: t };
}

const TOKEN = "eyJyaWQiOiJhYmMifQ.c2ln";

describe("feedKey", () => {
  it("emits a machine-speed burst terminated by Enter", () => {
    const { state, nextAt } = type(TOKEN, 5);
    const res = feedKey(state, { key: "Enter", timeStamp: nextAt });
    expect(res.emit).toBe(TOKEN);
    expect(res.capture).toBe(true);
    expect(res.state).toEqual(WEDGE_INIT);
  });

  it("emits on idle for scanners with no Enter suffix", () => {
    const { state } = type(TOKEN, 5);
    expect(commitIdle(state).emit).toBe(TOKEN);
  });

  it("starts capturing only after two fast characters, so at most two leak", () => {
    let s = WEDGE_INIT;
    const captures: boolean[] = [];
    let t = 1000;
    for (const key of TOKEN) {
      const r = feedKey(s, { key, timeStamp: t });
      captures.push(r.capture);
      s = r.state;
      t += 5;
    }
    expect(captures.slice(0, 2)).toEqual([false, false]);
    expect(captures[2]).toBe(true);
  });

  it("ignores human-speed typing", () => {
    const { state, nextAt } = type("anacruz", 150);
    expect(feedKey(state, { key: "Enter", timeStamp: nextAt }).emit).toBeUndefined();
    expect(commitIdle(state).emit).toBeUndefined();
  });

  it("rejects a fast burst that is too short to be a token", () => {
    const { state, nextAt } = type("abc", 5);
    expect(feedKey(state, { key: "Enter", timeStamp: nextAt }).emit).toBeUndefined();
  });

  it("rejects a fast burst containing non-token characters", () => {
    const { state, nextAt } = type("ana cruz santos", 5);
    expect(feedKey(state, { key: "Enter", timeStamp: nextAt }).emit).toBeUndefined();
  });

  it("a burst arriving mid-typing still emits — the human prefix is discarded", () => {
    const typed = type("ana", 150);
    const burst = type(TOKEN, 5, typed.nextAt + 400, typed.state);
    const res = feedKey(burst.state, { key: "Enter", timeStamp: burst.nextAt });
    expect(res.emit).toBe(TOKEN);
  });

  it("abandons a stale buffer rather than splicing two bursts together", () => {
    const first = type("eyJyaWQi", 5);
    const second = type(TOKEN, 5, first.nextAt + 500, first.state);
    const res = feedKey(second.state, { key: "Enter", timeStamp: second.nextAt });
    expect(res.emit).toBe(TOKEN);
  });

  it("ignores modifier combos so browser shortcuts keep working", () => {
    const res = feedKey(WEDGE_INIT, { key: "a", timeStamp: 1000, metaKey: true });
    expect(res.capture).toBe(false);
    expect(res.state).toEqual(WEDGE_INIT);
  });

  /** A HID scanner IS a keyboard: the browser emits a `Shift` keydown immediately
   *  before every uppercase character. Ticket tokens are base64url, so uppercase is
   *  everywhere — TOKEN has 'J', 'W', 'Q', 'i'… Every other test in this file feeds
   *  uppercase directly with no preceding Shift, which is why a reducer that resets
   *  on "Shift" passes all of them while the desk scanner is silently dead in the field. */
  function typeWithModifier(modifier: string, text: string, gapMs = 5, start = 1000) {
    let s = WEDGE_INIT;
    let t = start;
    for (const key of text) {
      if (/[A-Z]/.test(key)) {
        // The modifier keydown lands ~1ms before the character, and carries no character.
        s = feedKey(s, { key: modifier, timeStamp: t - 1 }).state;
      }
      s = feedKey(s, { key, timeStamp: t }).state;
      t += gapMs;
    }
    return { state: s, nextAt: t };
  }

  it("a Shift keydown before each uppercase character does not break the burst", () => {
    const { state, nextAt } = typeWithModifier("Shift", TOKEN);
    const res = feedKey(state, { key: "Enter", timeStamp: nextAt });
    expect(res.emit).toBe(TOKEN);          // the FULL token, not the trailing run
    expect(res.capture).toBe(true);
  });

  it("a CapsLock-toggling scanner still emits the full token", () => {
    const { state, nextAt } = typeWithModifier("CapsLock", TOKEN);
    expect(feedKey(state, { key: "Enter", timeStamp: nextAt }).emit).toBe(TOKEN);
  });

  it("leaves burst state completely untouched for every non-printing modifier", () => {
    const { state } = type(TOKEN.slice(0, 5), 5);
    for (const key of ["Shift", "CapsLock", "Control", "Alt", "Meta", "AltGraph", "Dead", "Unidentified"]) {
      const res = feedKey(state, { key, timeStamp: 2000 });
      expect(res.state).toEqual(state);
      expect(res.capture).toBe(false);
    }
  });

  it("a bare Control keydown (which sets ctrlKey on itself) does not wipe the burst", () => {
    const { state } = type(TOKEN.slice(0, 5), 5);
    expect(feedKey(state, { key: "Control", timeStamp: 2000, ctrlKey: true }).state).toEqual(state);
    // …but a real shortcut still does.
    expect(feedKey(state, { key: "a", timeStamp: 2000, ctrlKey: true }).state).toEqual(WEDGE_INIT);
  });

  it("a navigation key resets the buffer", () => {
    const { state } = type(TOKEN, 5);
    expect(feedKey(state, { key: "ArrowLeft", timeStamp: 2000 }).state).toEqual(WEDGE_INIT);
  });

  it("a mid-burst gap in the 31-80ms window restarts the candidate rather than extending it", () => {
    // 31-80ms is the gap band that is neither "fast" (<=30ms) nor "stale" (>80ms) —
    // the non-stale !fast branch, which every other human-speed test (150ms gaps)
    // skips past because those gaps exceed IDLE_COMMIT_MS and take the stale path.
    const { state, nextAt } = type(TOKEN.slice(0, 4), 5);
    const nextChar = TOKEN[4]!;
    const r = feedKey(state, { key: nextChar, timeStamp: nextAt + 50 });
    expect(r.state).toEqual({ buffer: nextChar, lastAt: nextAt + 50, fastCount: 0 });
    expect(r.capture).toBe(false);
  });
});

/** jsdom does not populate KeyboardEvent.timeStamp usefully, so set it explicitly. */
function press(key: string, timeStamp: number, target: Element | Document = document) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "timeStamp", { value: timeStamp });
  target.dispatchEvent(ev);
  return ev;
}

describe("useKeyboardWedge", () => {
  it("emits a scan and restores characters that leaked into the focused input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.value = "ana";
    input.focus();

    const onScan = vi.fn();
    renderHook(() => useKeyboardWedge(onScan, true));

    let t = 1000;
    for (const key of TOKEN) { press(key, t); t += 5; }
    press("Enter", t);

    expect(onScan).toHaveBeenCalledWith(TOKEN);
    expect(input.value).toBe("ana");
    document.body.removeChild(input);
  });

  it("emits through the real DOM path when Shift precedes every uppercase character", () => {
    const onScan = vi.fn();
    renderHook(() => useKeyboardWedge(onScan, true));
    let t = 1000;
    for (const key of TOKEN) {
      if (/[A-Z]/.test(key)) press("Shift", t - 1);
      press(key, t);
      t += 5;
    }
    press("Enter", t);
    expect(onScan).toHaveBeenCalledWith(TOKEN);
  });

  it("leaves genuine typing alone", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const onScan = vi.fn();
    renderHook(() => useKeyboardWedge(onScan, true));

    let t = 1000;
    for (const key of "ana") { press(key, t); t += 150; }
    expect(onScan).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does nothing when disabled", () => {
    const onScan = vi.fn();
    renderHook(() => useKeyboardWedge(onScan, false));
    let t = 1000;
    for (const key of TOKEN) { press(key, t); t += 5; }
    press("Enter", t);
    expect(onScan).not.toHaveBeenCalled();
  });

  function ControlledSearchBox({ onScan }: { onScan: (token: string) => void }) {
    const [q, setQ] = useState("ana");
    useKeyboardWedge(onScan, true);
    return createElement("input", {
      "aria-label": "search",
      value: q,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value),
    });
  }

  it("restores a React controlled input without leaving leaked characters in state", () => {
    // jsdom's synthetic keydown never inserts characters, so a plain burst of
    // `press()` calls leaves input.value untouched no matter what restore() does —
    // that alone would make this test pass even against a broken restore. Two
    // things are needed to actually exercise the bug:
    //
    // 1. The leak must be simulated the way a REAL leaked keystroke reaches React:
    //    writing through the native <input> prototype setter (bypassing React's
    //    instance-level value tracker) and then dispatching "input", so React's
    //    ChangeEventPlugin sees a genuine divergence and calls onChange — exactly
    //    like a real browser inserting a character outside React's control. A
    //    plain `input.value = "..."` or fireEvent.change assignment instead goes
    //    through React's OWN wrapped setter, which keeps the tracker in sync and
    //    never reproduces the divergence at all.
    // 2. The assertion must survive a forced re-render. A broken restore
    //    (`el.value = snapshot.value` directly) still visibly changes the DOM
    //    node, so `input.value` looks right immediately afterward even though
    //    React's internal state was never told — the leaked value is still there
    //    and reasserts itself the next time React reconciles this node.
    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

    const onScan = vi.fn();
    const { getByLabelText, rerender } = render(createElement(ControlledSearchBox, { onScan }));
    const input = getByLabelText("search") as HTMLInputElement;
    input.focus();

    let t = 1000;
    press(TOKEN[0]!, t); t += 5;
    press(TOKEN[1]!, t); t += 5; // capture is still false for these two — see threshold test above

    // Simulate the leak: real character insertion that React itself observes.
    nativeValueSetter.call(input, "ana" + TOKEN.slice(0, 2));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    for (const key of TOKEN.slice(2)) { press(key, t); t += 5; }
    press("Enter", t);

    expect(onScan).toHaveBeenCalledWith(TOKEN);

    // Force React to reconcile this node against its current internal state —
    // a broken restore leaves state holding the leaked value, which reappears
    // here even though the raw DOM node looked correct a moment ago.
    rerender(createElement(ControlledSearchBox, { onScan }));
    expect(input.value).toBe("ana");
  });

  it("ignores OS key auto-repeat so a held key never accumulates into a scan", () => {
    // macOS's fastest key-repeat interval is 30ms, at or under MAX_GAP_MS, so a
    // held token-charset key satisfies the gap and charset signals for free.
    // Without filtering, holding "a" would eventually cross MIN_TOKEN_LEN and
    // commitIdle would fire a bogus scan for "aaaaaaaaaaa".
    vi.useFakeTimers();
    try {
      const onScan = vi.fn();
      renderHook(() => useKeyboardWedge(onScan, true));
      let t = 1000;
      press("a", t); // initial keydown, not a repeat
      t += 30;
      for (let i = 0; i < 10; i++) {
        const ev = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true, repeat: true });
        Object.defineProperty(ev, "timeStamp", { value: t });
        document.dispatchEvent(ev);
        t += 30;
      }
      vi.advanceTimersByTime(IDLE_COMMIT_MS);
      expect(onScan).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits on the idle timer for scanners with no Enter suffix", () => {
    // Exercises the hook's setTimeout/IDLE_COMMIT_MS branch, which the reducer-level
    // commitIdle test cannot — that branch is the whole reason the no-suffix design
    // exists, and it is the only async, timer-ordered code in the hook.
    vi.useFakeTimers();
    try {
      const onScan = vi.fn();
      renderHook(() => useKeyboardWedge(onScan, true));
      let t = 1000;
      for (const key of TOKEN) { press(key, t); t += 5; }
      vi.advanceTimersByTime(IDLE_COMMIT_MS);
      expect(onScan).toHaveBeenCalledWith(TOKEN);
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses the keystroke via preventDefault only once the capture threshold is reached", () => {
    const onScan = vi.fn();
    renderHook(() => useKeyboardWedge(onScan, true));
    let t = 1000;
    const prevented: boolean[] = [];
    for (const key of TOKEN.slice(0, 3)) {
      const ev = press(key, t);
      prevented.push(ev.defaultPrevented);
      t += 5;
    }
    expect(prevented).toEqual([false, false, true]);
  });
});
