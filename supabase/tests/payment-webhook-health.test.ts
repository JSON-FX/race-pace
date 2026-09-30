import { afterEach, expect, it, vi } from "vitest";
import { pmPaymentWebhookIssue } from "../functions/_shared/paymongo";
afterEach(() => vi.unstubAllGlobals());
function setup(hooks: unknown[]) {
  vi.stubGlobal("Deno", { env: { get: (key: string) => key === "SUPABASE_URL" ? "https://project.supabase.co" : "sk_test_example" } });
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: hooks }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
const healthy = { attributes: { url: "https://project.supabase.co/functions/v1/payments-webhook", livemode: false, status: "enabled", events: ["checkout_session.payment.paid"] } };
it("checks only this environment endpoint without printing or retaining webhook secrets", async () => {
  const fetcher = setup([healthy]); expect(await pmPaymentWebhookIssue()).toBeNull();
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("webhooks?url=https%3A%2F%2Fproject.supabase.co"), expect.anything());
});
it.each([
  { ...healthy.attributes, status: "disabled" },
  { ...healthy.attributes, livemode: true },
  { ...healthy.attributes, events: ["payment.refunded"] },
  { ...healthy.attributes, url: "https://another.supabase.co/functions/v1/payments-webhook" },
])("alerts when the configured hook cannot deliver this environment's checkout captures", async attributes => {
  setup([{ attributes }]); expect(await pmPaymentWebhookIssue()).toBe("payment_webhook_disabled_or_missing");
});
