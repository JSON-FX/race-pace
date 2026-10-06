import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), single: vi.fn(), user: vi.fn(), send: vi.fn() }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: mocks.client }));
vi.mock("../functions/_shared/email.ts", () => ({ sendEmail: mocks.send }));
let handler: (req: Request) => Promise<Response>;
let settings: Record<string, string>;
const job = { id: "job-id", type: "payment_expiring", user_id: "runner-id", registration_id: "registration-id", event_id: "event-id", payload: {}, lease_token: "lease-id" };
const registration = () => ({ id: "registration-id", status: "pending", expires_at: new Date(Date.now() + 7200000).toISOString(), custom_data: { full_name: "Runner" }, events: { name: "Trail", status: "published", event_date: "2026-12-01", venue: "Davao", status_note: null }, categories: { label: "25 km" }, payments: { status: "pending" } });

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (name: string) => settings[name] }, serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/send-lifecycle-email/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  settings = { TRANSACTIONAL_EMAIL_WORKER_SECRET: "local-worker-secret", PUBLIC_SITE_URL: "https://staging.racepace.com.ph" };
  mocks.client.mockReturnValue({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }), auth: { admin: { getUserById: mocks.user } } });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "transactional_email_claim" ? [job] : true, error: null }));
  mocks.single.mockResolvedValue({ data: registration(), error: null });
  mocks.user.mockResolvedValue({ data: { user: { email: "runner@example.test", email_confirmed_at: "2026-10-01" } } });
  mocks.send.mockResolvedValue({ ok: true });
});
const request = (token = "local-worker-secret") => handler(new Request("http://local/email", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));

it("rejects invalid or missing worker credentials before privileged access", async () => {
  expect((await request("wrong")).status).toBe(401);
  delete settings.TRANSACTIONAL_EMAIL_WORKER_SECRET;
  expect((await request()).status).toBe(401);
  expect((await handler(new Request("http://local/email"))).status).toBe(405);
  expect(mocks.client).not.toHaveBeenCalled();
});
it.each(["", "javascript:alert(1)", "https://user:pass@example.test", "https://example.test?token=x"])("rejects unsafe site configuration %s before claiming jobs", async (url) => {
  settings.PUBLIC_SITE_URL = url;
  expect((await request()).status).toBe(500);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("sends a current job with stable idempotency and completes its exact lease", async () => {
  expect(await (await request()).json()).toEqual({ claimed: 1, sent: 1, skipped: 0, failed: 0 });
  expect(mocks.user).toHaveBeenCalledWith("runner-id");
  expect(mocks.send).toHaveBeenCalledWith("runner@example.test", expect.any(String), expect.stringContaining("https://staging.racepace.com.ph/pay/registration-id"), expect.any(String), { idempotencyKey: "lifecycle/job-id" });
  expect(mocks.rpc).toHaveBeenCalledWith("transactional_email_finish", { p_job: "job-id", p_lease: "lease-id", p_error: null });
});
it("skips a reminder when payment has completed", async () => {
  mocks.single.mockResolvedValue({ data: { ...registration(), status: "paid", payments: [{ status: "paid" }] }, error: null });
  expect(await (await request()).json()).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("retains failed transport as a retryable result without leaking provider details", async () => {
  mocks.send.mockResolvedValue({ ok: false, error: "private provider response" });
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
  expect(mocks.rpc).toHaveBeenCalledWith("transactional_email_finish", { p_job: "job-id", p_lease: "lease-id", p_error: "email_transport_failed" });
});
it("refuses delivery to unconfirmed email addresses", async () => {
  mocks.user.mockResolvedValue({ data: { user: { email: "runner@example.test", email_confirmed_at: null } } });
  expect((await request()).status).toBe(503);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("fails visibly when the claim or completion cannot be confirmed", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } });
  expect(await (await request()).json()).toEqual({ error: "claim_failed" });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "transactional_email_claim" ? [job] : false, error: null }));
  expect(await (await request()).json()).toEqual({ error: "completion_unknown" });
});
