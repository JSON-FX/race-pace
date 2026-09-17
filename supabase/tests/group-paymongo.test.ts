import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGroupSessionRequest, createGroupSession, extractGroupCaptures, retrieveGroupSession } from "../functions/_shared/groupPaymongo";
const attemptId = "10000000-0000-4000-8000-000000000001";
const orderId = "10000000-0000-4000-8000-000000000002";
const input = { attemptId, orderId, method: "gcash" as const, baseCents: 200000, platformFeeCents: 10000, processorSurchargeCents: 3214, grossCents: 213214, feeMode: "pass_on" as const, returnUrl: "https://racepace.example/bookings?order=one" };
const payment = (extra = {}) => ({ id: "pay_abc", attributes: { status: "paid", amount: 213214, currency: "PHP", livemode: false, ...extra } });
const session = (payments: unknown[], metadata: unknown = { payment_attempt_id: attemptId, booking_order_id: orderId }) => ({ data: { id: "cs_abc", attributes: { payments, metadata } } });
afterEach(() => vi.unstubAllGlobals());
describe("group PayMongo boundary", () => {
  it("prices one combined charge and retains return query without registration metadata", () => {
    const attributes = buildGroupSessionRequest(input).data.attributes;
    expect(attributes.line_items.reduce((sum, item) => sum + item.amount * item.quantity, 0)).toBe(213214);
    expect(attributes.line_items.map(item => item.name)).toEqual(["Race entries", "Taxes and fees", "Payment processing fee"]);
    expect(attributes.metadata).toEqual({ payment_attempt_id: attemptId, booking_order_id: orderId });
    expect(new URL(attributes.success_url).searchParams.get("order")).toBe("one");
    expect(new URL(attributes.success_url).searchParams.get("status")).toBe("success");
    expect(attributes.payment_method_types).toEqual(["gcash"]);
  });
  it("does not charge absorbed platform fees again", () => {
    const result = buildGroupSessionRequest({ ...input, feeMode: "absorb", processorSurchargeCents: 0, grossCents: 200000 });
    expect(result.data.attributes.line_items).toHaveLength(1);
  });
  it.each([NaN, 1.2, -1, 2147483648])("rejects malformed cents %s", grossCents => {
    expect(() => buildGroupSessionRequest({ ...input, grossCents })).toThrow();
  });
  it("rejects mismatched total", () => expect(() => buildGroupSessionRequest({ ...input, grossCents: 213215 })).toThrow("invalid_total"));
  it("uses provider idempotency and returns the validated session", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "cs_abc", attributes: { checkout_url: "https://checkout.paymongo.com/abc" } } })));
    vi.stubGlobal("fetch", fetcher);
    expect(await createGroupSession(buildGroupSessionRequest(input), attemptId, "test-secret")).toEqual({ sessionId: "cs_abc", checkoutUrl: "https://checkout.paymongo.com/abc" });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.paymongo.com/v1/checkout_sessions");
    expect(options.headers["Idempotency-Key"]).toBe(attemptId);
    expect(options.headers.Authorization).toBe(`Basic ${btoa("test-secret:")}`);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("creates v2 provider-managed pass-on without a local processing line", async () => {
    const body = buildGroupSessionRequest({ ...input, grossCents: 210000,
      processorSurchargeCents: 0, providerManagedFee: true });
    expect(body.data.attributes).toMatchObject({ pass_on_fees: true, reference_number: orderId });
    expect(body.data.attributes.line_items.map(item => item.name)).toEqual(["Race entries", "Taxes and fees"]);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      id: "cs_abc", attributes: { checkout_url: "https://checkout.paymongo.com/abc" },
    } })));
    vi.stubGlobal("fetch", fetcher);
    await createGroupSession(body, attemptId, "test-secret");
    expect(fetcher.mock.calls[0][0]).toBe("https://api.paymongo.com/v2/checkout_sessions");
  });
  it("sanitizes provider errors and transport failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret customer details", { status: 400 })));
    await expect(createGroupSession({}, attemptId, "secret")).rejects.toThrow(/^group_provider_request_unknown$/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret provider URL")));
    await expect(retrieveGroupSession("cs_abc", "secret")).rejects.toThrow(/^group_provider_request_unknown$/);
  });
  it("rejects malformed sessions and mismatched retrieval", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: { id: "cs_wrong", attributes: { checkout_url: "javascript:alert(1)" } } }))));
    await expect(createGroupSession({}, attemptId, "secret")).rejects.toThrow("response_invalid");
    await expect(retrieveGroupSession("cs_abc", "secret")).rejects.toThrow("response_invalid");
  });
  it("requires concrete paid captures even when an intent succeeded", () => {
    expect(extractGroupCaptures({ data: { id: "cs_abc", attributes: { payment_intent: { attributes: { status: "succeeded" } }, payments: [payment({ status: "failed" })] } } })).toEqual([]);
  });
  it("rejects a concrete paid record without a valid identity", () => {
    expect(() => extractGroupCaptures(session([{ ...payment(), id: null }]))).toThrow("invalid_capture_identity");
  });
  it("keeps all captures and unknown fees", () => {
    const result = extractGroupCaptures(session([payment(), { ...payment(), id: "pay_second" }]));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ amount: 213214, feeCents: null, livemode: false, attemptId, orderId, invalidReason: null });
  });
  it("accepts a genuine zero fee and balanced ledger", () => {
    expect(extractGroupCaptures(session([payment({ fee: 0, net_amount: 213214 })]))[0]).toMatchObject({ feeCents: 0, invalidReason: null });
  });
  it.each([{ fee: 10 }, { net_amount: 213214 }, { fee: 10, net_amount: 213214 }, { fee: -1, net_amount: 213215 }])("flags inconsistent fees %j", extra => {
    expect(extractGroupCaptures(session([payment(extra)]))[0]).toMatchObject({ feeCents: null, invalidReason: "invalid_fee" });
  });
  it.each([1.2, -1, 2147483648, "213214"]) ("flags invalid captured amount %s", amount => {
    expect(extractGroupCaptures(session([payment({ amount })]))[0]).toMatchObject({ amount: null, invalidReason: "invalid_amount" });
  });
  it("does not trust payment-level booking metadata", () => {
    expect(extractGroupCaptures(session([payment({ metadata: { payment_attempt_id: attemptId, booking_order_id: orderId } })], {}))[0]).toMatchObject({ attemptId: null, orderId: null, invalidReason: "invalid_metadata" });
  });
});
