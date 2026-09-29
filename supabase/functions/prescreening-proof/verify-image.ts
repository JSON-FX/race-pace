import { imageSize } from "npm:image-size@2.0.4";
import { z } from "zod";
import { PROOF_MAX_BYTES } from "../_shared/prescreening.ts";

const resultSchema = z.object({
  upload_id: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size_bytes: z.number().int().min(1).max(PROOF_MAX_BYTES),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width: z.number().int().positive(), height: z.number().int().positive(),
}).strict();

/** Header checks stay in Edge; native decoding cannot fit reliably in its 256 MB limit. */
export async function verifyProofImage(bytes: Uint8Array, proof: { upload_id: string; object_path: string; url: string }): Promise<string> {
  if (!bytes.length || bytes.length > PROOF_MAX_BYTES) throw new Error("proof_size_invalid");
  let dimensions;
  try { dimensions = imageSize(bytes); } catch { throw new Error("proof_image_invalid"); }
  const type = dimensions.type;
  if (type !== "jpg" && type !== "png" && type !== "webp") throw new Error("proof_type_invalid");
  if (!dimensions.width || !dimensions.height) throw new Error("proof_image_invalid");
  const endpoint = Deno.env.get("PROOF_VERIFIER_URL");
  const secret = Deno.env.get("PROOF_VERIFIER_SECRET");
  if (!endpoint || !secret || secret.length < 32) throw new Error("proof_unavailable");
  const target = new URL(endpoint);
  if (target.protocol !== "https:" && (target.protocol !== "http:" || Deno.env.get("DENO_DEPLOYMENT_ID") ||
      Deno.env.get("SUPABASE_URL") !== "http://kong:8000")) throw new Error("proof_unavailable");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = [...hash].map(value => value.toString(16).padStart(2, "0")).join("");
  let response: Response;
  try {
    const headers = new Headers({ "Content-Type": "application/json", Authorization: `Bearer ${secret}` });
    const bypass = Deno.env.get("PROOF_VERIFIER_BYPASS_SECRET");
    if (bypass) headers.set("x-vercel-protection-bypass", bypass);
    response = await fetch(target, { method: "POST", redirect: "error", signal: AbortSignal.timeout(28_000),
      headers,
      body: JSON.stringify({ ...proof, sha256 }) });
  } catch { throw new Error("proof_unavailable"); }
  const result = await response.json().catch(() => null);
  if (response.status === 422 && ["proof_size_invalid", "proof_image_invalid", "proof_type_invalid", "proof_dimensions_too_large"].includes(result?.error)) {
    throw new Error(result.error);
  }
  const parsed = resultSchema.safeParse(result);
  const mime = type === "jpg" ? "image/jpeg" : `image/${type}`;
  if (!response.ok || !parsed.success || parsed.data.upload_id !== proof.upload_id || parsed.data.sha256 !== sha256 ||
      parsed.data.size_bytes !== bytes.length || parsed.data.width !== dimensions.width || parsed.data.height !== dimensions.height ||
      parsed.data.content_type !== mime) throw new Error("proof_unavailable");
  return parsed.data.content_type;
}
