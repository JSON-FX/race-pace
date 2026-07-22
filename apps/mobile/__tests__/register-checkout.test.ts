import { startCheckout } from "../lib/registration";
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
});
