import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registration: { status: "paid", user_id: "runner-id", booked_by_user_id: "runner-id" },
  providerRef: "cs_test",
  configured: vi.fn(), getSession: vi.fn(), method: vi.fn(), confirm: vi.fn(), captures: vi.fn(),
}));

vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "runner-id" } }, error: null }) },
  from: (table: string) => ({ select: () => ({ eq: () => ({ single: async () => ({
    data: table === "registrations" ? { id: "registration-id", ...mocks.registration } : { provider_ref: mocks.providerRef },
  }) }) }) }),
}) }));
vi.mock("../functions/_shared/confirm.ts", () => ({ confirmPayment: mocks.confirm, reportedPaidCaptures: mocks.captures }));
vi.mock("../functions/_shared/paymongo.ts", () => ({
  paymongoConfigured: mocks.configured, pmGetCheckoutSession: mocks.getSession, pmMethodFromSession: mocks.method,
}));
vi.mock("../functions/_shared/cors.ts", () => ({ preflight: () => null, corsHeaders: () => ({}) }));

let handler: (request: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/payment-verify/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.registration = { status: "paid", user_id: "runner-id", booked_by_user_id: "runner-id" };
  mocks.providerRef = "cs_test";
  mocks.configured.mockReturnValue(true);
  mocks.getSession.mockResolvedValue({ id: "cs_test", paid: true, raw: { data: { id: "cs_test", attributes: { payments: [] } } } });
  mocks.method.mockReturnValue("gcash");
  mocks.confirm.mockResolvedValue({ ok: true, registration_id: "registration-id", already: true });
  mocks.captures.mockImplementation((raw: { data?: { attributes?: { payments?: unknown[] } } }) => raw.data?.attributes?.payments ?? []);
});

function request() {
  return handler(new Request("http://localhost/payment-verify", {
    method: "POST", headers: { Authorization: "Bearer runner-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ registration_id: "registration-id" }),
  }));
}

describe("payment verification after a booking is paid", () => {
  it("rechecks the bound PayMongo session so a second capture reaches the durable capture inbox", async () => {
    const raw = { data: { id: "cs_test", attributes: { payments: [
      { id: "pay_first", attributes: { status: "paid" } },
      { id: "pay_extra", attributes: { status: "paid" } },
    ] } } };
    mocks.getSession.mockResolvedValue({ id: "cs_test", paid: true, raw });
    mocks.confirm.mockResolvedValue({ ok: false, error: "capture_review_required", status: 503 });

    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "capture_review_required" });
    expect(mocks.getSession).toHaveBeenCalledWith("cs_test");
    expect(mocks.confirm).toHaveBeenCalledWith("registration-id", "gcash", {
      source: "payment-verify", session_id: "cs_test", session: raw,
    });
  });

  it("keeps an already-paid booking paid when PayMongo no longer serves its completed session", async () => {
    mocks.getSession.mockRejectedValue(new Error("paymongo_get_failed: not_found"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "paid", already: true });
      expect(mocks.confirm).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("does not downgrade an already-paid booking on an unpaid provider snapshot", async () => {
    mocks.getSession.mockResolvedValue({ id: "cs_test", paid: false, raw: {} });
    expect(await (await request()).json()).toEqual({ status: "paid", already: true });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("keeps an already-paid booking paid when the provider omits completed payment details", async () => {
    expect(await (await request()).json()).toEqual({ status: "paid", already: true });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("preserves the paid response when no provider session was bound", async () => {
    mocks.providerRef = "";
    expect(await (await request()).json()).toEqual({ status: "paid", already: true });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});

it.each(["expired", "cancelled"])("returns local %s status when PayMongo reports no capture", async (status) => {
  mocks.registration = { ...mocks.registration, status };
  mocks.getSession.mockResolvedValue({ id: "cs_test", paid: false, raw: {} });
  expect(await (await request()).json()).toEqual({ status });
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("still confirms a pending booking when PayMongo reports a capture", async () => {
  mocks.registration = { ...mocks.registration, status: "pending" };
  const response = await request();
  expect(await response.json()).toEqual({ status: "paid", registration_id: "registration-id" });
  expect(mocks.confirm).toHaveBeenCalledWith("registration-id", "gcash", expect.objectContaining({ session_id: "cs_test" }));
});

it("still reports a provider read failure for a pending booking", async () => {
  mocks.registration = { ...mocks.registration, status: "pending" };
  mocks.getSession.mockRejectedValue(new Error("provider unavailable"));
  const response = await request();
  expect(response.status).toBe(500);
  expect(mocks.confirm).not.toHaveBeenCalled();
});
