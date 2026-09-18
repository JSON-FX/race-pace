import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createCheckout: vi.fn(), payment: {} as Record<string, unknown> }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "runner-id", email: "runner@example.com" } } }) },
  from: (table: string) => table === "registrations" ? {
    select: () => ({ eq: () => ({ single: async () => ({ data: {
      id: "registration-id", user_id: "runner-id", booked_by_user_id: "runner-id",
      booking_order_id: null, status: "pending", total_amount: 10000,
      category_id: "category-id", event_id: "event-id", expires_at: new Date(Date.now() + 600_000).toISOString(),
      organizations: { is_active: true, fee_mode: "absorb", commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0 },
    } }) }) }),
  } : table === "events" ? {
    select: () => ({ eq: () => ({ single: async () => ({ data: { status: "open" } }) }) }),
  } : table === "payments" ? {
    select: () => ({ eq: () => ({ single: async () => ({ data: mocks.payment }) }) }),
  } : undefined,
}) }));
vi.mock("../functions/_shared/payments.ts", () => ({ getPaymentProviderByName: () => ({ createCheckout: mocks.createCheckout }) }));
vi.mock("../functions/_shared/cors.ts", () => ({ preflight: () => null, corsHeaders: () => ({}) }));
vi.mock("../functions/_shared/eventStatus.ts", () => ({ isRegistrationClosed: () => false }));

let handler: (request: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/payment-session/index.ts");
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.payment = {
    provider: "paymongo", provider_ref: null, checkout_url: null,
    checkout_fee_mode: "absorb", checkout_platform_fee: 300,
    checkout_provider_managed_fee: false,
    checkout_request: { registrationId: "registration-id", amount: 10000, description: "QA race",
      returnUrl: "https://staging.racepace.com.ph/pay/callback", passOnFees: false,
      lineItems: [{ name: "QA race", amount: 10000 }] },
  };
});
afterEach(() => vi.restoreAllMocks());

async function request() {
  return handler(new Request("http://localhost/payment-session", {
    method: "POST", headers: { Authorization: "Bearer test-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ registration_id: "registration-id", method: "gcash" }),
  }));
}

describe("uncertain PayMongo checkout creation", () => {
  it("does not replay a frozen create request when the provider session was not bound", async () => {
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "checkout_reconciliation_required" });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("fails closed for an older unbound payment without a frozen request", async () => {
    mocks.payment.checkout_request = null;
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "checkout_reconciliation_required" });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("reuses a bound session without asking PayMongo to mint another", async () => {
    mocks.payment.provider_ref = "cs_existing";
    mocks.payment.checkout_url = "https://checkout.paymongo.com/existing";
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checkout_url: "https://checkout.paymongo.com/existing" });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it.each([
    { provider_ref: "cs_existing", checkout_url: null },
    { provider_ref: null, checkout_url: "https://checkout.paymongo.com/orphan" },
    { provider_ref: "cs_existing", checkout_url: "https://example.com/unsafe" },
  ])("refuses incomplete or unsafe provider bindings %#", async (binding) => {
    mocks.payment = { ...mocks.payment, ...binding };
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "provider_fee_session_unavailable" });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
});
