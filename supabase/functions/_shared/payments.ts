import { paymongoConfigured, pmCreateCheckoutSession } from "./paymongo.ts";

export interface CheckoutInput { registrationId: string; amount: number; description: string; returnUrl: string }
export interface CheckoutResult { checkoutUrl: string; providerRef: string }
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
}

/** Dev/local provider — no real PayMongo. Serves a hosted sandbox checkout page.
 *  NOTE: the sandbox page only renders on the LOCAL stack; hosted Supabase serves
 *  Edge Function responses as text/plain, so use PayMongo on cloud. */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  constructor(private functionsUrl: string) {}
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return {
      checkoutUrl: `${this.functionsUrl}/fake-checkout?rid=${input.registrationId}`,
      providerRef: `fake_${input.registrationId}`,
    };
  }
}

/** Real PayMongo (test or live, per the secret key). Creates a hosted Checkout Session;
 *  the customer pays on checkout.paymongo.com and is redirected back to the app via the
 *  returnUrl scheme. Payment is confirmed server-side by re-fetching the session (see the
 *  payment-verify function) — never trusted from the redirect. */
export class PayMongoProvider implements PaymentProvider {
  readonly name = "paymongo";
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const session = await pmCreateCheckoutSession({
      lineItems: [{
        name: input.description || "Race registration",
        amount: input.amount, // already in centavos
        currency: "PHP",
        quantity: 1,
      }],
      paymentMethodTypes: ["card", "gcash", "paymaya"],
      description: input.description,
      successUrl: withStatus(input.returnUrl, "paid"),
      cancelUrl: withStatus(input.returnUrl, "cancel"),
      metadata: { registration_id: input.registrationId },
    });
    return { checkoutUrl: session.checkoutUrl, providerRef: session.id };
  }
}

function withStatus(base: string, status: string): string {
  return base + (base.includes("?") ? "&" : "?") + "status=" + status;
}

// Swap point: real PayMongo when PAYMONGO_SECRET_KEY is set, else the local fake page.
export function getPaymentProvider(): PaymentProvider {
  if (paymongoConfigured()) return new PayMongoProvider();
  const base = Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? "http://127.0.0.1:54521/functions/v1";
  return new FakePaymentProvider(base);
}
