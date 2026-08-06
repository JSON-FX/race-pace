import imageCompression from "browser-image-compression";
import { supabase } from "./supabase";

const BUCKET = "event-images";
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Compress an image to <=3MB and <=2000px on its longest edge, in a Web Worker. */
export async function compressImage(file: File): Promise<File> {
  return imageCompression(file, { maxSizeMB: 3, maxWidthOrHeight: 2000, useWebWorker: true });
}

/** Compress `file`, upload it under {orgId}/{uuid}.{ext}, and return its public URL. */
export async function uploadEventImage(orgId: string, file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Please choose a JPG, PNG, or WebP image.");
  const compressed = await compressImage(file);
  const ext = EXT[compressed.type] ?? EXT[file.type] ?? "jpg";
  const path = `${orgId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    contentType: compressed.type || file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
