import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock("npm:nodemailer@10.0.10", () => ({ default: { createTransport: smtp.createTransport } }));
let env: Record<string, string>;
beforeEach(() => {
  env = { EMAIL_PROVIDER: "mailtrap", MAILTRAP_SMTP_USER: "test-user", MAILTRAP_SMTP_PASSWORD: "test-pass" };
  vi.stubGlobal("Deno", { env: { get: (key: string) => env[key] } });
  smtp.createTransport.mockReturnValue(smtp);
  smtp.sendMail.mockResolvedValue({ accepted: ["runner@example.com"] });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("ticket email transport", () => {
  it("captures only through the TLS-required Mailtrap sandbox", async () => {
    expect(await sendEmail("runner@example.com", "Ticket", "<p>Ticket</p>")).toEqual({ ok: true });
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "sandbox.smtp.mailtrap.io", requireTLS: true }));
    expect(smtp.close).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails without sandbox credentials and does not fall through to live sending", async () => {
    delete env.MAILTRAP_SMTP_PASSWORD;
    expect(await sendEmail("runner@example.com", "Ticket", "html")).toEqual({ ok: false, error: "mailtrap_not_configured" });
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns failure and closes the transport on an SMTP error", async () => {
    smtp.sendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));
    expect(await sendEmail("runner@example.com", "Ticket", "html")).toEqual({ ok: false, error: "mailtrap_send_failed" });
    expect(smtp.close).toHaveBeenCalled();
  });
  it("retains Resend as the default provider", async () => {
    delete env.EMAIL_PROVIDER;
    env.RESEND_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await sendEmail("runner@example.com", "Ticket", "html")).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.any(Object));
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });
});

describe("local Mailpit transport", () => {
  beforeEach(() => { env = { EMAIL_PROVIDER: "mailpit" }; });
  it("captures mail without external credentials or live-provider fallback", async () => {
    expect(await sendEmail("runner@example.com", "Ticket", "html")).toEqual({ok:true});
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({host:"inbucket",port:1025,ignoreTLS:true}));
    expect(smtp.createTransport.mock.calls.at(-1)?.[0]).not.toHaveProperty("auth");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports recipient rejection without claiming sent", async () => {
    smtp.sendMail.mockResolvedValueOnce({accepted:[]});
    expect(await sendEmail("runner@example.com", "Ticket", "html")).toEqual({ok:false,error:"mailpit_rejected"});
    expect(smtp.close).toHaveBeenCalled();
  });
  it("closes a failed transport without contacting Resend", async () => {
    smtp.sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    expect(await sendEmail("runner@example.com", "Ticket", "html")).toEqual({ok:false,error:"mailpit_send_failed"});
    expect(smtp.close).toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
});
