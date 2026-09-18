import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ serviceClient: vi.fn(), sendEmail: vi.fn() }));
vi.mock("../_shared/supabase.ts", () => ({ serviceClient: mocks.serviceClient }));
vi.mock("../_shared/email.ts", async (original) => ({
  ...await original<typeof import("../_shared/email.ts")>(), sendEmail: mocks.sendEmail,
}));
let handler: (req: Request) => Promise<Response>;
let paidQuery: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; single: ReturnType<typeof vi.fn> };
beforeAll(async () => {
  const env: Record<string, string> = {
    TICKET_EMAIL_SECRET: "qa-secret", PUBLIC_SITE_URL: "https://racepace.test",
    PUBLIC_FUNCTIONS_URL: "https://functions.test",
  };
  vi.stubGlobal("Deno", { env: { get: (key: string) => env[key] }, serve: (fn: typeof handler) => { handler = fn; } });
  await import("./index");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  const regQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: {
    id: "938b1bb5-1ed0-406c-9e9f-d1b5d13a29ba", status: "paid", user_id: null,
    booked_by_user_id: "helper", custom_data: { full_name: "QA Elder Participant" },
    total_amount: 100000, ticket_token: "test-ticket", events: { name: "QA Race" }, categories: { label: "10K" },
  } }) };
  paidQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { amount: 106599 }, error: null }) };
  mocks.serviceClient.mockReturnValue({ from: (table: string) => table === "registrations" ? regQuery : paidQuery,
    auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "helper@example.com" } } }) } },
  });
  mocks.sendEmail.mockResolvedValue({ ok: true });
});
function request() {
  return new Request("http://localhost/send-ticket-email", { method: "POST", headers: { Authorization: "Bearer qa-secret", "Content-Type": "application/json" }, body: JSON.stringify({ registration_id: "938b1bb5-1ed0-406c-9e9f-d1b5d13a29ba" }) });
}
it("emails the helper the participant identity and captured gross, including passed-on fees", async () => {
  expect((await handler(request())).status).toBe(200);
  expect(paidQuery.eq).toHaveBeenCalledWith("status", "paid");
  const [recipient, , html, text] = mocks.sendEmail.mock.calls[0];
  expect(recipient).toBe("helper@example.com");
  expect(html).toContain("QA Elder Participant");
  expect(html).toContain("₱1,065.99");
  expect(html).not.toContain("₱1,000.00");
  expect(text).toContain("Event: QA Race\nCategory: 10K\nTotal paid: ₱1,065.99");
});
it("does not invent a paid total when the payment ledger is unavailable", async () => {
  paidQuery.single.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  expect((await handler(request())).status).toBe(409);
  expect(mocks.sendEmail).not.toHaveBeenCalled();
});
