import { createHash, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { PROOF_MAX_BYTES } from "@race-pace/shared";

const inputSchema = z.object({
  upload_id: z.string().uuid(),
  object_path: z.string().max(200),
  url: z.string().url().max(4096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
let activeDecodes = 0;

class ProofError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Buffer> {
  if (!body) throw new ProofError("proof_unavailable", 503);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new ProofError("proof_size_invalid", 422);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

function signedProofUrl(input: z.infer<typeof inputSchema>): URL {
  const expected = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const url = new URL(input.url);
  const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
  const local = ["127.0.0.1", "localhost"].includes(expected.hostname);
  if ((!local && expected.protocol !== "https:") || url.origin !== expected.origin ||
      url.username || url.password || url.hash ||
      !new RegExp(`^${uuid}/${uuid}/${input.upload_id}$`).test(input.object_path) ||
      url.pathname !== `/storage/v1/object/sign/prescreening-proofs/${input.object_path}` ||
      !url.searchParams.get("token") || [...url.searchParams.keys()].some(key => key !== "token") ||
      url.searchParams.getAll("token").length !== 1) {
    throw new ProofError("invalid_input", 400);
  }
  return url;
}

function signature(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new ProofError("proof_type_invalid", 422);
}

/** No database credentials: Edge owns authorization and the verified-state transition. */
export async function verifyProofRequest(request: Request): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const secret = process.env.PROOF_VERIFIER_SECRET;
  if (!secret || secret.length < 32) return json({ error: "proof_unavailable" }, 503);
  const supplied = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(supplied), digest(`Bearer ${secret}`))) return json({ error: "unauthorized" }, 401);
  // Fluid instances may serve concurrent requests. Never queue unbounded image buffers.
  if (activeDecodes >= 1) return json({ error: "proof_unavailable" }, 503);
  activeDecodes++;
  try {
    const body = await boundedBytes(request.body, 8192);
    const parsed = inputSchema.safeParse(JSON.parse(body.toString("utf8")));
    if (!parsed.success) return json({ error: "invalid_input" }, 400);
    const input = parsed.data;
    const url = signedProofUrl(input);
    const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new ProofError("proof_unavailable", 503);
    const bytes = await boundedBytes(response.body, PROOF_MAX_BYTES);
    if (!bytes.length) throw new ProofError("proof_size_invalid", 422);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== input.sha256) throw new ProofError("proof_unavailable", 503);
    const format = signature(bytes);
    let width: number, height: number;
    try {
      // Keep native codec safety defaults. The product limit is compressed file size, not 20MP.
      const metadata = await sharp(bytes, { failOn: "warning" }).metadata();
      if (metadata.format !== format || !metadata.width || !metadata.height) throw new Error("invalid_image");
      const decoded = await sharp(bytes, { failOn: "warning", sequentialRead: true })
        .timeout({ seconds: 10 }).raw().toBuffer({ resolveWithObject: true });
      width = decoded.info.width; height = decoded.info.height;
      if (width !== metadata.width || height !== metadata.height) throw new Error("dimensions_mismatch");
    } catch (error) {
      if (error instanceof ProofError) throw error;
      if (error instanceof Error && /timeout/i.test(error.message)) throw new ProofError("proof_unavailable", 503);
      throw new ProofError("proof_image_invalid", 422);
    }
    return json({ upload_id: input.upload_id, sha256: hash, size_bytes: bytes.length,
      content_type: `image/${format}`, width, height });
  } catch (error) {
    if (error instanceof ProofError) return json({ error: error.code }, error.status);
    if (error instanceof SyntaxError) return json({ error: "invalid_input" }, 400);
    // Signed URLs, proof bytes and service credentials must never appear in logs.
    return json({ error: "proof_unavailable" }, 503);
  } finally { activeDecodes--; }
}
