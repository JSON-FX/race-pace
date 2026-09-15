import { describe, expect, it } from "vitest";
import { FakePaymentProvider } from "../functions/_shared/payments.ts";

describe("fake checkout handoff", () => {
  it.each([
    "https://racepace.lan/pay/registration?next=%2Fraces&source=checkout",
    "racepace://pay-callback",
  ])("preserves the callback required by the sandbox: %s", async (returnUrl) => {
    const provider = new FakePaymentProvider("http://127.0.0.1:54521/functions/v1");
    const checkout = await provider.createCheckout({
      registrationId: "registration-id",
      amount: 100000,
      description: "QA registration",
      returnUrl,
    });
    const url = new URL(checkout.checkoutUrl);
    expect(url.pathname).toBe("/functions/v1/fake-checkout");
    expect(url.searchParams.get("rid")).toBe("registration-id");
    expect(url.searchParams.get("return")).toBe(returnUrl);
    expect(checkout.providerRef).toBe("fake_registration-id");
  });
});
