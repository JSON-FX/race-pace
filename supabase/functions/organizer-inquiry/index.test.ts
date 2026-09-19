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

function request(body: unknown, method = "POST") {
  return new Request("http://localhost/organizer-inquiry", {
    method,
    headers: { "content-type": "application/json", Origin: "http://localhost:3000" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

it("delivers a valid inquiry to the fixed Race Pace inbox", async () => {
  const response = await handler(request({
    name: "Ana Runner",
    email: "ana@example.com",
    organization: "North Ridge Events",
    website: "",
  }));

  expect(response.status).toBe(200);
  expect(mocks.sendEmail).toHaveBeenCalledWith(
    "inquiries@racepace.com.ph",
    "Organizer inquiry — North Ridge Events",
    expect.stringContaining("North Ridge Events"),
    expect.stringContaining("Email: ana@example.com"),
    { replyTo: "ana@example.com" },
  );
});

it("rejects invalid input without sending", async () => {
  const response = await handler(request({ name: "A", email: "bad", organization: "X" }));

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
  const response = await handler(request({
    name: "Ana Runner",
    email: "ana@example.com",
    organization: "North Ridge Events",
    website: "https://spam.example",
  }));

  expect(response.status).toBe(200);
  expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it("reports delivery failure without exposing provider details", async () => {
  mocks.sendEmail.mockResolvedValue({ ok: false, error: "resend_500: provider detail" });

  const response = await handler(request({
    name: "Ana Runner",
    email: "ana@example.com",
    organization: "North Ridge Events",
  }));

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "delivery_failed" });
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
