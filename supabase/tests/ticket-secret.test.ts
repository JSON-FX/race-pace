import { describe, expect, it } from "vitest";
import { mintTicketToken, requireTicketSigningSecret, verifyTicketToken } from "../functions/_shared/ticket";

describe("ticket signing configuration", () => {
  it.each([undefined, "", "  "])("rejects a missing or blank secret (%s)", (secret) => {
    expect(() => requireTicketSigningSecret(secret)).toThrow("ticket_signing_not_configured");
  });

  it("preserves configured signing and verification", async () => {
    const secret = requireTicketSigningSecret("configured-test-secret");
    const payload = { rid: "registration", eid: "event", iat: 1 };
    const token = await mintTicketToken(payload, secret);
    expect(await verifyTicketToken(token, secret)).toEqual(payload);
    expect(await verifyTicketToken(token, "different-secret")).toBeNull();
  });
});
