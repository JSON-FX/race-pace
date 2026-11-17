import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), read: vi.fn(), user: vi.fn(), send: vi.fn() }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: mocks.client }));
vi.mock("../functions/_shared/email.ts", () => ({ sendEmail: mocks.send }));
let handler: (req: Request) => Promise<Response>;
let job: Record<string, unknown>;
const dueAt = "2027-02-21T16:00:00Z";
const registration = () => ({ id: "entry", user_id: "runner", event_id: "event", status: "pending", total_amount: 180000,
  pay_later_grant_id: "grant", pay_later_due_at: dueAt, expires_at: dueAt,
  custom_data: { full_name: "Juan Dela Cruz" },
  events: { name: "Apo Ridge Trail", status: "open", event_date: "2027-03-21" },
  categories: { label: "21 km" }, organizations: { is_active: true }, payments: { status: "pending", amount: 180000, checkout_provider_managed_fee: false } });
const grant = () => ({ id: "grant", user_id: "runner", event_id: "event", due_at: dueAt, registration_id: null,
  events: { name: "Apo Ridge Trail", status: "open", event_date: "2027-03-21" },
  organizations: { name: "North Ridge Running", is_active: true } });
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (name: string) => ({ TRANSACTIONAL_EMAIL_WORKER_SECRET: "local", PUBLIC_SITE_URL: "https://racepace.test" })[name] },
    serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/send-lifecycle-email/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-02-14T01:00:00Z"));
  job = { id: "job", type: "pay_later_reminder_7d", user_id: "runner", event_id: "event", registration_id: "entry",
    payload: { grant_id: "grant", due_at: dueAt, due_date: "2027-02-21" }, lease_token: "lease" };
  mocks.client.mockReturnValue({ rpc: mocks.rpc, from: (table: string) => {
    const query = { select: () => query, eq: () => query, in: () => query, limit: () => query, maybeSingle: () => mocks.read(table) };
    return query;
  }, auth: { admin: { getUserById: mocks.user } } });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "transactional_email_claim" ? [job] : true, error: null }));
  mocks.read.mockResolvedValue({ data: registration(), error: null });
  mocks.user.mockResolvedValue({ data: { user: { email: "juan@example.test", email_confirmed_at: "2026-01-01", user_metadata: { full_name: "Juan Dela Cruz" } } }, error: null });
  mocks.send.mockResolvedValue({ ok: true });
});
const request = () => handler(new Request("http://local/email", { method: "POST", headers: { Authorization: "Bearer local" } }));
it("delivers a current reminder using a stable idempotency key", async () => {
  expect(await (await request()).json()).toMatchObject({ sent: 1, failed: 0 });
  expect(mocks.send).toHaveBeenCalledWith("juan@example.test", "Apo Ridge Trail payment is due in 7 days", expect.stringContaining("https://racepace.test/pay/entry"), expect.any(String), { idempotencyKey: "lifecycle/job" });
});
it.each(["paid", "expired", "refunded"])("suppresses reminders for %s registrations", async status => {
  mocks.read.mockResolvedValue({ data: { ...registration(), status }, error: null });
  expect(await (await request()).json()).toMatchObject({ skipped: 1, sent: 0 });
});
it("does not send stale seven-day copy on a later retry day", async () => {
  vi.setSystemTime(new Date("2027-02-15T01:00:00Z"));
  expect(await (await request()).json()).toMatchObject({ skipped: 1, sent: 0 });
});
it("sends the one-day reminder only on the Philippine calendar day before the deadline", async () => {
  job.type = "pay_later_reminder_1d";
  vi.setSystemTime(new Date("2027-02-19T23:00:00Z"));
  expect(await (await request()).json()).toMatchObject({ sent: 1 });
  expect(mocks.send.mock.calls[0][1]).toContain("tomorrow");
});
it("retries a database read failure instead of discarding the email", async () => {
  mocks.read.mockResolvedValue({ data: null, error: { message: "connection lost" } });
  expect((await request()).status).toBe(503);
  expect(mocks.rpc).toHaveBeenCalledWith("transactional_email_finish", { p_job: "job", p_lease: "lease", p_error: "registration_read_failed" });
});
it("suppresses changed deadlines and mismatched recipients", async () => {
  mocks.read.mockResolvedValue({ data: { ...registration(), user_id: "someone-else" }, error: null });
  expect(await (await request()).json()).toMatchObject({ skipped: 1 });
  mocks.read.mockResolvedValue({ data: { ...registration(), pay_later_due_at: "2027-02-22T16:00:00Z" }, error: null });
  expect(await (await request()).json()).toMatchObject({ skipped: 1 });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("sends invalidation only after actual expiry, with no payment link", async () => {
  job.type = "pay_later_expired";
  vi.setSystemTime(new Date(dueAt));
  expect(await (await request()).json()).toMatchObject({ skipped: 1 });
  mocks.read.mockResolvedValue({ data: { ...registration(), status: "expired", payments: { status: "failed" } }, error: null });
  expect(await (await request()).json()).toMatchObject({ sent: 1 });
  expect(mocks.send.mock.calls[0][2]).toContain("https://racepace.test/ticket/entry");
  expect(mocks.send.mock.calls[0][2]).not.toContain("https://racepace.test/pay/");
});
it("does not invalidate a paid ticket after a delayed callback", async () => {
  job.type = "pay_later_expired";
  vi.setSystemTime(new Date(dueAt));
  mocks.read.mockResolvedValue({ data: { ...registration(), status: "paid", payments: { status: "paid" } }, error: null });
  expect(await (await request()).json()).toMatchObject({ skipped: 1 });
});
it("invites an eligible runner but skips an already-used grant", async () => {
  job.type = "pay_later_granted"; job.registration_id = null;
  mocks.read.mockImplementation(async (table: string) => ({ data: table === "pay_later_grants" ? grant() : null, error: null }));
  expect(await (await request()).json()).toMatchObject({ sent: 1 });
  expect(mocks.send.mock.calls[0][2]).toContain("https://racepace.test/events/event");
  mocks.read.mockImplementation(async (table: string) => ({ data: table === "pay_later_grants" ? grant() : { id: "entry" }, error: null }));
  expect(await (await request()).json()).toMatchObject({ skipped: 1 });
});
it("retains failed transport for retry", async () => {
  mocks.send.mockResolvedValue({ ok: false });
  expect((await request()).status).toBe(503);
  expect(mocks.rpc).toHaveBeenCalledWith("transactional_email_finish", expect.objectContaining({ p_error: "email_transport_failed" }));
});

it("suppresses an approval when admission closed before delivery", async () => {
  job.type = "pay_later_granted";
  mocks.read.mockResolvedValue({ data: { ...grant(), events: { ...grant().events, registration_closes_at: "2027-02-13T00:00:00Z" } }, error: null });
  expect(await (await request()).json()).toMatchObject({ skipped: 1, sent: 0 });
});
it("suppresses an approval for a consumed grant even after reservation expiry", async () => {
  job.type = "pay_later_granted";
  mocks.read.mockResolvedValue({ data: { ...grant(), registration_id: "entry" }, error: null });
  expect(await (await request()).json()).toMatchObject({ skipped: 1, sent: 0 });
});
it("suppresses payment prompts during organization suspension", async () => {
  mocks.read.mockResolvedValue({ data: { ...registration(), organizations: { is_active: false } }, error: null });
  expect(await (await request()).json()).toMatchObject({ skipped: 1, sent: 0 });
});
