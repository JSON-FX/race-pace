"use client";

import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";

export type OrgImageKind = "avatar" | "cover";

const BUCKET = "org-images";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Compress an image to <=3MB and <=2000px on its longest edge, in a Web Worker.
 *  Duplicated from lib/imageUpload.ts's compressImage (same body) rather than
 *  imported from it: that module still imports the removed "./supabase"
 *  singleton for its own uploadEventImage export (out of this task's scope —
 *  event images belong to the Task 11 event editor), so importing anything
 *  from it fails to resolve at both test and build time. Keep this in sync
 *  with lib/imageUpload.ts's compressImage if either changes. */
async function compressImage(file: File): Promise<File> {
  return imageCompression(file, { maxSizeMB: 3, maxWidthOrHeight: 2000, useWebWorker: true });
}

/** Compress `blob` and upload it under {orgId}/{kind}-{uuid}.{ext}; return the public URL.
 *  Ported verbatim from the old lib/org.ts, only swapping the removed
 *  ./supabase singleton for the browser createClient(). Stays client-side
 *  deliberately: it uploads a Blob produced by a canvas crop (CropUploader),
 *  which cannot cross the Server Action boundary efficiently. */
// Assumes a pre-normalized (cropped) blob from the Branding page — no accepted-type
// guard here; the crop step produces a known image type. Add a guard if reused elsewhere.
export async function uploadOrgImage(orgId: string, blob: Blob, kind: OrgImageKind): Promise<string> {
  const supabase = createClient();
  const file = blob instanceof File ? blob : new File([blob], "image", { type: blob.type || "image/png" });
  const compressed = await compressImage(file);
  const ext = EXT[compressed.type] ?? "png";
  const path = `${orgId}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, { contentType: compressed.type, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
