import { describe, it, expect } from "vitest";
import { payoutRowState } from "./payouts";

const base = { status: "open", net_owed_cents: 100000, event_finished: true };

describe("payoutRowState", () => {
  it("is ready when the event finished and money is owed", () => {
    expect(payoutRowState(base)).toBe("ready");
  });

  it("is held while the event is still running", () => {
    // Greyed with a reason rather than hidden: when an organizer asks "where's
    // my money for Dumalinao?", the operator should read the answer off screen.
    expect(payoutRowState({ ...base, event_finished: false })).toBe("held");
  });

  it("is paid once settled", () => {
    expect(payoutRowState({ ...base, status: "paid" })).toBe("paid");
  });

  it("is owed_back when clawbacks exceed new earnings", () => {
    // A negative row must never render as a payment instruction — that is how
    // someone transfers the money in the wrong direction.
    expect(payoutRowState({ ...base, net_owed_cents: -270000 })).toBe("owed_back");
  });

  it("treats a settled negative statement as paid, not owed_back", () => {
    expect(payoutRowState({ status: "paid", net_owed_cents: -270000, event_finished: true })).toBe("paid");
  });
});
