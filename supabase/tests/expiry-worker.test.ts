import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), expire: vi.fn(), get: vi.fn(), confirm: vi.fn(), method: vi.fn(),
}));
vi.mock("../functions/_shared/authz.ts", () => ({ isAuthorizedBearer: () => true }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("../functions/_shared/paymongo.ts", () => ({
  pmExpireCheckoutSession: mocks.expire,
  pmGetCheckoutSession: mocks.get,
  pmMethodFromSession: mocks.method,
}));
vi.mock("../functions/_shared/confirm.ts", () => ({ confirmPayment: mocks.confirm }));

let handler: (request: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "worker-test-secret" }, serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/expire-paymongo-checkouts/index.ts");
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation(async (name: string) => name === "paymongo_expiry_candidates"
    ? { data: [{ registration_id: "registration-id", session_id: "cs_test" }] }
    : name === "finish_paymongo_checkout_expiry" ? { data: "expired" } : { data: null });
  mocks.expire.mockResolvedValue("expired");
  mocks.method.mockReturnValue("gcash");
});

async function runWorker() {
  const response = await handler(new Request("http://localhost/expire-paymongo-checkouts", { method: "POST" }));
  expect(response.status).toBe(200);
  return response.json();
}

describe("PayMongo checkout expiry worker", () => {
  it("releases a stale slot only after PayMongo confirms the session expired", async () => {
    mocks.get.mockResolvedValue({ id: "cs_test", paid: false, status: "expired", raw: {} });
    expect(await runWorker()).toEqual({ processed: 1, outcomes: { expired: 1 } });
    expect(mocks.rpc).toHaveBeenCalledWith("finish_paymongo_checkout_expiry", expect.objectContaining({
      p_registration_id: "registration-id", p_session_id: "cs_test",
    }));
  });

  it("confirms captured money instead of releasing the slot", async () => {
    mocks.get.mockResolvedValue({ id: "cs_test", paid: true, status: "paid", raw: { data: {} } });
    mocks.confirm.mockResolvedValue({ ok: true, registration_id: "registration-id" });
    expect(await runWorker()).toEqual({ processed: 1, outcomes: { captured: 1 } });
    expect(mocks.confirm).toHaveBeenCalledWith("registration-id", "gcash", expect.objectContaining({ source: "expiry-worker" }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("finish_paymongo_checkout_expiry", expect.anything());
  });

  it("keeps an ongoing PayMongo session pending", async () => {
    mocks.expire.mockResolvedValue("inspect");
    mocks.get.mockResolvedValue({ id: "cs_test", paid: false, status: "active", raw: {} });
    expect(await runWorker()).toEqual({ processed: 1, outcomes: { provider_payment_ongoing: 1 } });
    expect(mocks.rpc).toHaveBeenCalledWith("record_paymongo_expiry_attempt", expect.objectContaining({ p_outcome: "provider_payment_ongoing" }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("finish_paymongo_checkout_expiry", expect.anything());
  });

  it("retains the reservation and records a retry after an uncertain provider response", async () => {
    mocks.expire.mockRejectedValue(new Error("timeout"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runWorker()).toEqual({ processed: 1, outcomes: { retry_required: 1 } });
      expect(mocks.rpc).not.toHaveBeenCalledWith("finish_paymongo_checkout_expiry", expect.anything());
    } finally { log.mockRestore(); }
  });
});
