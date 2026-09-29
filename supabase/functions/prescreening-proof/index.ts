import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { verifyProofImage } from "./verify-image.ts";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), category_id: z.string().uuid(), participant_passport_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("verify"), upload_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("view"), upload_id: z.string().uuid() }).strict(),
]);

Deno.serve(async req => {
  const pre = preflight(req);
  if (pre) return pre;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req.headers.get("Origin")) },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const db = serviceClient();
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user?.email_confirmed_at || auth.user.is_anonymous) return json({ error: "verified_account_required" }, 401);
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_input" }, 400);
  const input = parsed.data;
  if (input.action === "prepare") {
    const category = await db.from("categories").select("id,event_id,org_id,prescreening_enabled,events(status),organizations(is_active)").eq("id", input.category_id).single();
    const passport = await db.from("runner_passports").select("id,claimed_user_id").eq("id", input.participant_passport_id).single();
    const managers = await db.from("passport_managers").select("passport_id").eq("passport_id", input.participant_passport_id).eq("user_id", auth.user.id);
    const c = category.data;
    const event = c?.events as unknown as { status: string } | null;
    const org = c?.organizations as unknown as { is_active: boolean } | null;
    if (category.error || passport.error || managers.error || !c?.prescreening_enabled || !org?.is_active ||
      !event || !["coming_soon", "open", "almost_full"].includes(event.status) ||
      (passport.data?.claimed_user_id !== auth.user.id && (passport.data?.claimed_user_id !== null || !managers.data?.length))) {
      return json({ error: "proof_not_accessible" }, 403);
    }
    const id = crypto.randomUUID();
    const objectPath = `${c.org_id}/${auth.user.id}/${id}`;
    const saved = await db.from("prescreening_uploads").insert({ id, org_id: c.org_id, event_id: c.event_id,
      category_id: c.id, participant_passport_id: input.participant_passport_id, booked_by_user_id: auth.user.id, object_path: objectPath });
    if (saved.error) return json({ error: "proof_unavailable" }, 503);
    return json({ upload_id: id, bucket: "prescreening-proofs", object_path: objectPath });
  }
  const read = await db.from("prescreening_uploads").select("*").eq("id", input.upload_id).single();
  const upload = read.data;
  if (read.error || !upload) return json({ error: "proof_not_accessible" }, 403);
  let allowed = upload.booked_by_user_id === auth.user.id;
  if (!allowed && input.action === "view") {
    // The caller-scoped client applies tenant RLS. A guessed upload UUID alone
    // never authorizes a signed link to a private object.
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
    });
    const application = await caller.from("prescreening_applications").select("id").eq("proof_upload_id", upload.id).maybeSingle();
    allowed = !application.error && !!application.data;
  }
  if (!allowed) return json({ error: "proof_not_accessible" }, 403);
  if (input.action === "view") {
    if (!upload.verified_at) return json({ error: "verified_proof_required" }, 409);
    const signed = await db.storage.from("prescreening-proofs").createSignedUrl(upload.object_path, 120);
    if (signed.error) return json({ error: "proof_unavailable" }, 503);
    const viewUrl = new URL(signed.data.signedUrl);
    // The local CLI signs against its Docker hostname, which browsers cannot
    // resolve. Use the configured public gateway without changing the signature.
    if (Deno.env.get("SUPABASE_URL") === "http://kong:8000" && !Deno.env.get("DENO_DEPLOYMENT_ID")) {
      const gateway = Deno.env.get("PUBLIC_FUNCTIONS_URL");
      if (gateway) {
        const publicUrl = new URL(gateway);
        viewUrl.protocol = publicUrl.protocol; viewUrl.host = publicUrl.host;
      }
    }
    return json({ url: viewUrl.toString(), expires_in: 120 });
  }
  if (upload.verified_at) return json({ upload_id: upload.id, verified: true });
  const downloaded = await db.storage.from("prescreening-proofs").download(upload.object_path);
  if (downloaded.error) return json({ error: "proof_upload_incomplete" }, 409);
  try {
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const contentType = await verifyProofImage(bytes);
    const verified = await db.from("prescreening_uploads").update({ verified_at: new Date().toISOString(), size_bytes: bytes.length, content_type: contentType })
      .eq("id", upload.id).select("id").single();
    if (verified.error) return json({ error: "proof_unavailable" }, 503);
    return json({ upload_id: upload.id, verified: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "proof_unavailable";
    if (["proof_size_invalid", "proof_image_invalid", "proof_type_invalid", "proof_dimensions_too_large"].includes(code)) {
      return json({ error: code }, 422);
    }
    console.error("[prescreening-proof] verification unavailable");
    return json({ error: "proof_unavailable" }, 503);
  }
});
