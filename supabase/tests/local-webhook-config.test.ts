import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { localWebhookSigner } from "../../test/webhook";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("local webhook signing configuration", () => {
  it("signs the exact payload with the configured functions key", () => {
    vi.mocked(readFileSync).mockReturnValue('PAYMONGO_WEBHOOK_SECRET="fixture-key"\n');
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const raw = '{"data": {"value": 1}}';
    const sign = localWebhookSigner("http://127.0.0.1:54521");
    const expected = createHmac("sha256", "fixture-key").update(`1700000000.${raw}`).digest("hex");
    expect(sign(raw)).toBe(`t=1700000000,te=${expected}`);
    expect(readFileSync).toHaveBeenCalledWith("supabase/functions/.env");
  });

  it("supports the same custom file used by functions serve", () => {
    vi.stubEnv("SUPABASE_FUNCTIONS_ENV_FILE", "/tmp/custom-functions.env");
    vi.mocked(readFileSync).mockReturnValue("PAYMONGO_WEBHOOK_SECRET=fixture-key");
    localWebhookSigner("http://localhost:54521");
    expect(readFileSync).toHaveBeenCalledWith("/tmp/custom-functions.env");
  });

  it("refuses a hosted target before reading credentials", () => {
    vi.mocked(readFileSync).mockClear();
    expect(() => localWebhookSigner("https://project.supabase.co")).toThrow("loopback");
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("fails without leaking credentials or file contents", () => {
    vi.mocked(readFileSync).mockReturnValue("OTHER_SECRET=do-not-print");
    expect(() => localWebhookSigner("http://127.0.0.1:54521")).toThrow("missing PAYMONGO_WEBHOOK_SECRET");
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error("do-not-print"); });
    expect(() => localWebhookSigner("http://127.0.0.1:54521")).toThrow("Cannot read local functions environment");
  });
});
