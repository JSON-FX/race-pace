import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("../_shared/email.ts", () => ({ sendEmail: mocks.sendEmail }));

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => key === "SITE_ORIGINS" ? "http://localhost:3000" : undefined },
    serve: (fn: typeof handler) => { handler = fn; },
  });
  await import("./index");
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendEmail.mockResolvedValue({ ok: true });
});

const validInquiry = {
  firstName: "Ana",
  lastName: "Runner",
  email: "ana@example.com",
  audience: "runner",
  subject: "Registration payment",
  message: "Please help me verify my payment.",
  website: "",
};

function request(body: unknown, method = "POST") {
  return new Request("http://localhost/organizer-inquiry", {
    method,
    headers: { "content-type": "application/json", Origin: "http://localhost:3000" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

it("delivers the inquiry to Race Pace and acknowledges the supplied email", async () => {
  const response = await handler(request(validInquiry));

  expect(response.status).toBe(200);
  expect(mocks.sendEmail).toHaveBeenNthCalledWith(
    1,
    "inquiries@racepace.com.ph",
    "Runner inquiry — Registration payment",
    expect.stringContaining("Please help me verify my payment."),
    expect.stringContaining("Email: ana@example.com"),
    { replyTo: "ana@example.com" },
  );
  expect(mocks.sendEmail).toHaveBeenNthCalledWith(
    2,
    "ana@example.com",
    "We received your Race Pace inquiry",
    expect.stringContaining("Thank you for reaching out."),
    expect.stringContaining("you will receive feedback from our team soon"),
    { replyTo: "inquiries@racepace.com.ph" },
  );
});

it("rejects invalid input without sending", async () => {
  const response = await handler(request({ ...validInquiry, email: "bad" }));

  expect(response.status).toBe(400);
  expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it("rejects malformed JSON without treating it as a server failure", async () => {
  const response = await handler(new Request("http://localhost/organizer-inquiry", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "http://localhost:3000" },
    body: "{not-json",
  }));

  expect(response.status).toBe(400);
  expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it("quietly drops honeypot submissions", async () => {
  const response = await handler(request({ ...validInquiry, website: "https://spam.example" }));

  expect(response.status).toBe(200);
  expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it("reports Race Pace inbox delivery failure without sending an acknowledgement", async () => {
  mocks.sendEmail.mockResolvedValueOnce({ ok: false, error: "resend_500: provider detail" });

  const response = await handler(request(validInquiry));

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "delivery_failed" });
  expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
});

it("reports acknowledgement delivery failure", async () => {
  mocks.sendEmail
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, error: "resend_500: provider detail" });

  const response = await handler(request(validInquiry));

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "delivery_failed" });
  expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
});

it("allows only POST after CORS preflight", async () => {
  expect((await handler(request({}, "GET"))).status).toBe(405);

  const preflightResponse = await handler(new Request("http://localhost/organizer-inquiry", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000" },
  }));
  expect(preflightResponse.status).toBe(204);
  expect(preflightResponse.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
});
