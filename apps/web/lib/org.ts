import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { compressImage } from "./imageUpload";

export type OrgBranding = { id: string; name: string; logo_url: string | null; banner_url: string | null };
export type OrgImageKind = "avatar" | "cover";

const BUCKET = "org-images";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function useMyOrg(orgId?: string) {
  return useQuery<OrgBranding | null>({
    queryKey: ["my-org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id,name,logo_url,banner_url").eq("id", orgId!).single();
      if (error) throw error;
      return data as OrgBranding;
    },
  });
}

/** Compress `blob` and upload it under {orgId}/{kind}-{uuid}.{ext}; return the public URL. */
// Assumes a pre-normalized (cropped) blob from the Branding page — no accepted-type
// guard here; the crop step produces a known image type. Add a guard if reused elsewhere.
export async function uploadOrgImage(orgId: string, blob: Blob, kind: OrgImageKind): Promise<string> {
  const file = blob instanceof File ? blob : new File([blob], "image", { type: blob.type || "image/png" });
  const compressed = await compressImage(file);
  const ext = EXT[compressed.type] ?? "png";
  const path = `${orgId}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, { contentType: compressed.type, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function updateOrgBranding(orgId: string, patch: { logo_url?: string; banner_url?: string }): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("organizations").update(patch).eq("id", orgId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
