import { describe, it, expect } from "vitest";
import { mintTicketToken, verifyTicketToken } from "./ticket";

describe("ticket token", () => {
  const secret = "test-secret";
  it("round-trips a valid token", async () => {
    const token = await mintTicketToken({ rid: "r1", eid: "e1", iat: 1 }, secret);
    const payload = await verifyTicketToken(token, secret);
    expect(payload).toEqual({ rid: "r1", eid: "e1", iat: 1 });
  });
  it("rejects a tampered or wrong-secret token", async () => {
    const token = await mintTicketToken({ rid: "r1", eid: "e1", iat: 1 }, secret);
    expect(await verifyTicketToken(token, "wrong")).toBeNull();
    expect(await verifyTicketToken(token.slice(0, -2) + "xx", secret)).toBeNull();
  });
});
