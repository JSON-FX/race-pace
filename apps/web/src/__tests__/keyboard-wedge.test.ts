import { describe, it, expect, vi } from "vitest";
import { feedKey, commitIdle, WEDGE_INIT, type WedgeState } from "../lib/keyboardWedge";
import { renderHook } from "@testing-library/react";
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

  it("a navigation key resets the buffer", () => {
    const { state } = type(TOKEN, 5);
    expect(feedKey(state, { key: "ArrowLeft", timeStamp: 2000 }).state).toEqual(WEDGE_INIT);
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
});
