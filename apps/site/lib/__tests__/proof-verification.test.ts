import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyProofRequest } from "../server/proof-verification";

const secret = "test-only-proof-verifier-secret-32-characters";
const origin = "https://staging-proof-test.supabase.co";
const id = "11111111-1111-4111-8111-111111111111";
const path = `22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/${id}`;
const imageUrl = `${origin}/storage/v1/object/sign/prescreening-proofs/${path}?token=test`;
const fixture = (name: string) => readFileSync(resolve(process.cwd(), "../../supabase/tests/fixtures/proofs", name));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function request(bytes: Buffer, overrides: Record<string, unknown> = {}, authorization = `Bearer ${secret}`) {
  return new Request("https://staging.example/api/internal/prescreening-proof", { method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ upload_id: id, object_path: path, url: imageUrl, sha256: sha(bytes), ...overrides }) });
}
function serve(bytes: Buffer) {
  const fetcher = vi.fn(async () => new Response(new Uint8Array(bytes)));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
beforeEach(() => {
  vi.stubEnv("PROOF_VERIFIER_SECRET", secret);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("private native proof verification", () => {
  it("requires the server secret before fetching any image", async () => {
    const bytes = fixture("valid.png"), fetcher = serve(bytes);
    expect((await verifyProofRequest(request(bytes, {}, "Bearer wrong"))).status).toBe(401);
    vi.stubEnv("PROOF_VERIFIER_SECRET", "");
    expect((await verifyProofRequest(request(bytes))).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    imageUrl.replace(origin, "https://foreign.supabase.co"),
    imageUrl.replace("https://", "http://"),
    imageUrl.replace("staging-proof-test", "staging-proof-test.supabase.co.attacker"),
    imageUrl.replace("prescreening-proofs", "other-bucket"),
    `${imageUrl}&width=1`, `${imageUrl}&token=second`, `${imageUrl}#fragment`,
    imageUrl.replace("https://", "https://user:password@"),
    imageUrl.replace(id, "44444444-4444-4444-8444-444444444444"),
  ])("rejects a foreign or unbound URL: %s", async url => {
    const bytes = fixture("valid.png"), fetcher = serve(bytes);
    expect((await verifyProofRequest(request(bytes, { url }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["20mp-rgb.png", "image/png"], ["20mp-rgba16.png", "image/png"],
    ["20mp-progressive.jpeg", "image/jpeg"], ["20mp.webp", "image/webp"], ["20mp-lossless.webp", "image/webp"],
  ])("fully decodes the genuine 20MP %s fixture", async (name, mime) => {
    const bytes = fixture(name), fetcher = serve(bytes);
    const response = await verifyProofRequest(request(bytes));
    expect(await response.json()).toEqual({ upload_id: id, sha256: sha(bytes), size_bytes: bytes.length,
      content_type: mime, width: 5000, height: 4000 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith(new URL(imageUrl), expect.objectContaining({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it("accepts exactly 10MB and images above the removed 20MP limit", async () => {
    const bytes = Buffer.alloc(10_000_000); fixture("20mp-rgb.png").copy(bytes); serve(bytes);
    expect((await verifyProofRequest(request(bytes))).status).toBe(200);
    const oversized = fixture("over20mp.png"); serve(oversized);
    const response = await verifyProofRequest(request(oversized));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ width: 5001, height: 4000 });
  });
  it.each(["48mp.png", "48mp.jpeg"])("accepts a 48MP %s below 10MB", async name => {
    const bytes = fixture(name); serve(bytes);
    expect(bytes.length).toBeLessThan(10_000_000);
    const response = await verifyProofRequest(request(bytes));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ width: 8000, height: 6000 });
  });
  it("rejects unsupported signatures before the native codec", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'); serve(svg);
    const response = await verifyProofRequest(request(svg));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "proof_type_invalid" });
  });
  it.each(["20mp-rgb.png", "20mp-progressive.jpeg", "20mp.webp"])("rejects truncated %s then accepts a valid proof", async name => {
    const bytes = fixture(name).subarray(0, 200); serve(bytes);
    const invalid = await verifyProofRequest(request(bytes));
    expect(invalid.status).toBe(422);
    const valid = fixture("valid.png"); serve(valid);
    expect((await verifyProofRequest(request(valid))).status).toBe(200);
  });
  it("rejects changed bytes and upstream failures without success", async () => {
    const bytes = fixture("valid.png"); serve(bytes);
    expect((await verifyProofRequest(request(bytes, { sha256: "0".repeat(64) }))).status).toBe(503);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("redirect or timeout")));
    expect((await verifyProofRequest(request(bytes))).status).toBe(503);
  });
  it("cancels streamed oversize data even without a content-length header", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(10_000_001)); }, cancel,
    }))));
    const response = await verifyProofRequest(request(fixture("valid.png")));
    expect(response.status).toBe(422); expect(cancel).toHaveBeenCalledOnce();
  });
  it("bounds concurrent decodes and recovers when requests finish", async () => {
    const bytes = fixture("20mp-rgb.png");
    const releases: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => releases.push(() => resolve(new Response(new Uint8Array(bytes)))))));
    const first = verifyProofRequest(request(bytes));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect((await verifyProofRequest(request(bytes))).status).toBe(503);
    releases.forEach(release => release());
    expect((await first).status).toBe(200);
    serve(bytes); expect((await verifyProofRequest(request(bytes))).status).toBe(200);
  });
});
