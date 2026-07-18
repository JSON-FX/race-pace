export interface CheckoutInput { registrationId: string; amount: number; description: string }
export interface CheckoutResult { checkoutUrl: string; providerRef: string }
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
}

/** Dev/local provider — no real PayMongo. Returns a fake checkout URL. */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  constructor(private appUrl: string) {}
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return {
      checkoutUrl: `${this.appUrl}/dev/pay/${input.registrationId}`,
      providerRef: `fake_${input.registrationId}`,
    };
  }
}

// Swap point when PayMongo is ready: return a PayMongoProvider when PAYMONGO_SECRET is set.
export function getPaymentProvider(): PaymentProvider {
  return new FakePaymentProvider(Deno.env.get("PUBLIC_APP_URL") ?? "http://127.0.0.1:8081");
}
