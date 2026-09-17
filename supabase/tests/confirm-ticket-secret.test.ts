import { afterEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
  single: vi.fn(async () => ({ data: { id: "registration-a", event_id: "event-a", status: "pending" } })),
}));
vi.mock("../functions/_shared/supabase.ts", () => ({
  serviceClient: () => ({
    rpc: db.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ single: db.single }) }),
      update: db.update,
    }),
  }),
}));

import { confirmPayment } from "../functions/_shared/confirm";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("does not change the payment ledger or mint a ticket without a signing secret", async () => {
  vi.stubGlobal("Deno", { env: { get: () => undefined } });

  await expect(confirmPayment("registration-a", "gcash")).resolves.toEqual({
    ok: false, error: "ticket_signing_not_configured", status: 503,
  });
  expect(db.update).not.toHaveBeenCalled();
  expect(db.rpc).not.toHaveBeenCalled();
});
