import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirmPayment: vi.fn(async () => ({ ok: true, registration_id: "test-registration" })),
  serviceClient: vi.fn(),
  environment: {} as Record<string, string | undefined>,
}));
vi.mock("../functions/_shared/confirm.ts", () => ({ confirmPayment: mocks.confirmPayment }));
vi.mock("../functions/_shared/paymongo.ts", () => ({
  paymongoConfigured: () => !!mocks.environment.PAYMONGO_SECRET_KEY,
}));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: mocks.serviceClient }));

let handler: (request: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => mocks.environment[name] },
    serve: (fn: typeof handler) => { handler = fn; },
  });
  await import("../functions/fake-checkout/index.ts");
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.environment = {};
});
afterEach(() => vi.restoreAllMocks());

const pay = () => handler(new Request(
  "https://example.supabase.co/functions/v1/fake-checkout?rid=test-registration&return=https%3A%2F%2Fexample.com&action=pay",
));

it.each([undefined, "https://example.supabase.co", "http://127.0.0.1:54521"])(
  "denies a non-CLI runtime even without a PayMongo key (%s)", async (supabaseUrl) => {
    mocks.environment.SUPABASE_URL = supabaseUrl;
    const response = await pay();
    expect(response.status).toBe(404);
    expect(mocks.confirmPayment).not.toHaveBeenCalled();
    expect(mocks.serviceClient).not.toHaveBeenCalled();
  },
);

it("denies hosted checkout page reads before the service client is created", async () => {
  mocks.environment.SUPABASE_URL = "https://example.supabase.co";
  const response = await handler(new Request(
    "https://example.supabase.co/functions/v1/fake-checkout?rid=test-registration&return=https%3A%2F%2Fexample.com",
  ));
  expect(response.status).toBe(404);
  expect(mocks.serviceClient).not.toHaveBeenCalled();
});

it("keeps the local CLI sandbox usable when PayMongo is not configured", async () => {
  mocks.environment.SUPABASE_URL = "http://kong:8000";
  const response = await pay();
  expect(response.status).toBe(200);
  expect(mocks.confirmPayment).toHaveBeenCalledExactlyOnceWith(
    "test-registration", "gcash", { source: "fake-checkout" },
  );
});

it("denies a hosted deployment even if its API URL looks local and PayMongo is absent", async () => {
  mocks.environment.DENO_DEPLOYMENT_ID = "project_function_version";
  mocks.environment.SUPABASE_URL = "http://kong:8000";
  const response = await pay();
  expect(response.status).toBe(404);
  expect(mocks.confirmPayment).not.toHaveBeenCalled();
  expect(mocks.serviceClient).not.toHaveBeenCalled();
});

it("denies the local sandbox when PayMongo is configured", async () => {
  mocks.environment.SUPABASE_URL = "http://kong:8000";
  mocks.environment.PAYMONGO_SECRET_KEY = "configured-test-key";
  const response = await pay();
  expect(response.status).toBe(404);
  expect(mocks.confirmPayment).not.toHaveBeenCalled();
});
