import { afterEach, describe, expect, it, vi } from "vitest";
import { PayMongoProvider } from "../functions/_shared/payments.ts";

afterEach(() => vi.unstubAllGlobals());

describe("PayMongo provider-calculated checkout fees", () => {
  it("creates a v2 pass-on session without an application-calculated processor line", async () => {
    vi.stubGlobal("Deno", { env: { get: (name: string) => name === "PAYMONGO_SECRET_KEY" ? "sk_test_unit_only" : undefined } });
    const calls: { url: string; body: unknown; key: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("Idempotency-Key") });
      return new Response(JSON.stringify({ data: { id: "cs_test", attributes: { checkout_url: "https://checkout.paymongo.com/test", status: "active" } } }), { status: 200 });
    }));

    const result = await new PayMongoProvider().createCheckout({
      registrationId: "registration-id", amount: 10300, description: "5K",
      returnUrl: "https://staging.racepace.com.ph/pay/callback?rid=registration-id",
      methods: ["gcash"], passOnFees: true,
      lineItems: [{ name: "5K", amount: 10000 }, { name: "Taxes and fees", amount: 300 }],
      metadata: { fee_mode: "pass_on" },
    });

    expect(result.providerRef).toBe("cs_test");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.paymongo.com/v2/checkout_sessions");
    expect(calls[0].key).toBe("checkout:registration-id");
    expect(calls[0].body).toMatchObject({ data: { attributes: {
      pass_on_fees: true, reference_number: "registration-id",
      payment_method_types: ["gcash"],
      line_items: [{ amount: 10000 }, { amount: 300 }],
      metadata: { registration_id: "registration-id", fee_mode: "pass_on" },
    } } });
  });

  it("keeps absorb-mode sessions on the existing request path", async () => {
    vi.stubGlobal("Deno", { env: { get: (name: string) => name === "PAYMONGO_SECRET_KEY" ? "sk_test_unit_only" : undefined } });
    const calls: { url: string; body: unknown; key: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("Idempotency-Key") });
      return new Response(JSON.stringify({ data: { id: "cs_test", attributes: { checkout_url: "https://checkout.paymongo.com/test", status: "active" } } }), { status: 200 });
    }));
    await new PayMongoProvider().createCheckout({ registrationId: "registration-id", amount: 10000, description: "5K", returnUrl: "https://staging.racepace.com.ph/pay/callback" });
    expect(calls[0].url).toBe("https://api.paymongo.com/v1/checkout_sessions");
    expect(calls[0].key).toBe("checkout:registration-id");
    expect(JSON.stringify(calls[0].body)).not.toContain("pass_on_fees");
  });

  it("sends an identical provider request when checkout creation is retried", async () => {
    vi.stubGlobal("Deno", { env: { get: (name: string) => name === "PAYMONGO_SECRET_KEY" ? "sk_test_unit_only" : undefined } });
    const calls: { key: string | null; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ key: new Headers(init.headers).get("Idempotency-Key"), body: String(init.body) });
      return new Response(JSON.stringify({ data: { id: "cs_same", attributes: { checkout_url: "https://checkout.paymongo.com/same", status: "active" } } }), { status: 200 });
    }));
    const frozen = { registrationId: "registration-id", amount: 10000, description: "5K", returnUrl: "https://staging.racepace.com.ph/pay/callback?rid=registration-id", lineItems: [{ name: "5K", amount: 10000 }], passOnFees: false };
    const provider = new PayMongoProvider();
    expect(await provider.createCheckout(frozen)).toEqual(await provider.createCheckout(frozen));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
  });

  it("rejects a malformed provider response before any checkout URL can be saved", async () => {
    vi.stubGlobal("Deno", { env: { get: (name: string) => name === "PAYMONGO_SECRET_KEY" ? "sk_test_unit_only" : undefined } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { id: "unexpected", attributes: { checkout_url: "https://example.com/checkout" } } }), { status: 200 })));
    await expect(new PayMongoProvider().createCheckout({
      registrationId: "registration-id", amount: 10000, description: "5K",
      returnUrl: "https://staging.racepace.com.ph/pay/callback",
    })).rejects.toThrow("paymongo_checkout_response_invalid");
  });
});
