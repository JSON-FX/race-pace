import { beforeEach, expect, it, vi } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { CheckoutError, startCheckout } from "../registration";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
const input = { event_id: "event", category_id: "category", addon_ids: [], custom_data: {},
  waiver_accepted: true, idempotency_key: "checkout-123", pay_later_grant_id: "grant", prescreening_batch_id: "screening" };
beforeEach(() => vi.clearAllMocks());

it("sends explicit approval intent alongside the ordinary deferred checkout flag", async () => {
  invoke.mockResolvedValue({ data: { registration_id: "r1", checkout_url: null, payment_plan: "pay_later", pay_later_due_at: "2027-02-21T16:00:00Z" }, error: null });
  const result = await startCheckout(input);
  expect(invoke).toHaveBeenCalledWith("registrations-checkout", { body: expect.objectContaining({
    pay_later_grant_id: "grant", prescreening_batch_id: "screening", defer_payment: true,
  }) });
  expect(result.payment_plan).toBe("pay_later");
});

it("carries the existing entry's plan through duplicate submission errors", async () => {
  invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({
    error: "already_registered", registration_id: "existing", payment_plan: "pay_later",
  }), { status: 409 })) });
  const error = await startCheckout(input).catch(error => error);
  expect(error).toBeInstanceOf(CheckoutError);
  expect(error.registrationId).toBe("existing");
  expect(error.paymentPlan).toBe("pay_later");
});

it("does not infer a deferred reservation for ordinary checkout", async () => {
  invoke.mockResolvedValue({ data: { registration_id: "ordinary", checkout_url: null }, error: null });
  const { pay_later_grant_id: _grant, prescreening_batch_id: _screening, ...ordinary } = input;
  expect((await startCheckout(ordinary)).payment_plan).toBeUndefined();
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty("pay_later_grant_id");
});
