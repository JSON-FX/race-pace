"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { GUIDE_BUCKET, GUIDE_URL_SECONDS, guideInputSchema } from "@/lib/guides";

export async function saveGuideAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const roles = await getMyRoles();
  if (!roles?.isSuperAdmin) return { ok: false, error: "Only super admins can save guides." };
  const parsed = guideInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the guide details." };
  const guide = parsed.data;
  const supabase = await createClient();
  // Upload first, save second. A failed metadata request keeps immutable paths
  // in the dialog so a retry does not upload the same video again.
  for (const path of [guide.storage_path, guide.thumbnail_path].filter((p): p is string => !!p)) {
    const name = path.split("/")[1];
    const { data, error } = await supabase.storage.from(GUIDE_BUCKET).list(guide.id, { search: name, limit: 10 });
    if (error || !data?.some(object => object.name === name)) return { ok: false, error: "The uploaded file could not be found. Try again." };
  }
  const { data, error } = await supabase.from("guide_videos").upsert({ ...guide, updated_at: new Date().toISOString() }).select("id");
  if (error || !data?.length) {
    console.error("[guide] save failed", { id: guide.id, error });
    return { ok: false, error: "Guide could not be saved. Your upload is ready; try saving again." };
  }
  revalidatePath("/guide");
  return { ok: true };
}

export async function guidePlaybackAction(id: string): Promise<{ url?: string; error?: string }> {
  const roles = await getMyRoles();
  if (!roles?.isOrgAdmin || !z.string().uuid().safeParse(id).success) return { error: "You don’t have access to this guide." };
  const supabase = await createClient();
  const { data: guide, error } = await supabase.from("guide_videos").select("storage_path").eq("id", id).maybeSingle();
  if (error || !guide) return { error: "This guide is no longer available. Refresh the library." };
  const signed = await supabase.storage.from(GUIDE_BUCKET).createSignedUrl(guide.storage_path, GUIDE_URL_SECONDS);
  if (signed.error || !signed.data) return { error: "Video couldn’t load. Check your connection, then try again." };
  return { url: signed.data.signedUrl };
}
