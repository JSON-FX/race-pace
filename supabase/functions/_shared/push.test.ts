import { describe, it, expect } from "vitest";
import { buildExpoMessages, chunk, deadTokens } from "./push";

describe("push helpers", () => {
  it("fans out one Expo message per (notification, token) with type in the payload", () => {
    const notes = [{ id: "n1", user_id: "u1", type: "paid", title: "T", body: "B", data: { event_id: "e1" } }];
    const tokens = new Map([["u1", ["ExponentPushToken[a]", "ExponentPushToken[b]"]]]);
    const msgs = buildExpoMessages(notes, tokens);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ to: "ExponentPushToken[a]", title: "T", body: "B", data: { event_id: "e1", type: "paid" } });
  });
  it("chunks into batches of at most 100", () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i), 100).map((c) => c.length)).toEqual([100, 100, 50]);
  });
  it("collects DeviceNotRegistered tokens from Expo tickets", () => {
    const msgs = [{ to: "tokA", title: "", body: "", data: {} }, { to: "tokB", title: "", body: "", data: {} }];
    const tickets = [{ status: "ok" as const }, { status: "error" as const, details: { error: "DeviceNotRegistered" } }];
    expect(deadTokens(msgs, tickets)).toEqual(["tokB"]);
  });
});
