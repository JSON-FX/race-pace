import { startCheckout, CheckoutError } from "../lib/registration";
import { FunctionsHttpError } from "@supabase/supabase-js";

const mockInvoke = jest.fn();
jest.mock("../lib/supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } } }));
jest.mock("expo-linking", () => ({ createURL: (p: string) => `racepace://${p}` }));

const input = { event_id: "e1", category_id: "c1", addon_ids: [], custom_data: {}, waiver_accepted: true, idempotency_key: "k1" } as never;

describe("startCheckout", () => {
  it("returns the checkout result on success", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { registration_id: "r1", checkout_url: "u1" }, error: null });
    await expect(startCheckout(input)).resolves.toEqual({ registration_id: "r1", checkout_url: "u1" });
    // sends the app's deep link so the server can set PayMongo's success/cancel URLs
    expect(mockInvoke).toHaveBeenCalledWith("registrations-checkout", { body: expect.objectContaining({ return_url: "racepace://pay-callback" }) });
  });
  it("surfaces the Edge Function's real error body (e.g. sold_out)", async () => {
    const err = new FunctionsHttpError({ json: async () => ({ error: "sold_out" }) } as never);
    mockInvoke.mockResolvedValueOnce({ data: null, error: err });
    await expect(startCheckout(input)).rejects.toThrow("sold_out");
  });
  // registrations-checkout's 409 contract: { error: "already_registered", registration_id,
  // status, checkout_url } — the register screen needs registration_id to redirect straight
  // to the runner's existing entry instead of just showing an error string.
  it("carries registration_id on the already_registered 409 so the caller can redirect", async () => {
    const err = new FunctionsHttpError({
      json: async () => ({ error: "already_registered", registration_id: "r-existing", status: "pending", checkout_url: "u1" }),
    } as never);
    mockInvoke.mockResolvedValueOnce({ data: null, error: err });
    await expect(startCheckout(input)).rejects.toMatchObject({
      message: "already_registered",
      registrationId: "r-existing",
    });
  });
  it("leaves registrationId undefined for errors that don't carry one", async () => {
    const err = new FunctionsHttpError({ json: async () => ({ error: "sold_out" }) } as never);
    mockInvoke.mockResolvedValueOnce({ data: null, error: err });
    await expect(startCheckout(input)).rejects.toBeInstanceOf(CheckoutError);
    mockInvoke.mockResolvedValueOnce({ data: null, error: err });
    try {
      await startCheckout(input);
    } catch (e) {
      expect((e as CheckoutError).registrationId).toBeUndefined();
    }
  });
});
