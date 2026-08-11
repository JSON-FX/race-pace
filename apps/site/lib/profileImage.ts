"use client";

import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";
import type { PhotoKind } from "@race-pace/shared";

// Framing lives in @race-pace/shared: this app writes the format and the admin
// console reads it, and two parsers for one string is how they drift. Re-exported
// so callers still have a single import for "profile photos".
export {
  PHOTO_ASPECT,
  FULL_FRAME,
  withFraming,
  parsePhotoUrl,
  framedImageStyle,
  type Framing,
  type PhotoKind,
} from "@race-pace/shared";

const BUCKET = "profile-images";
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** An avatar is shown at 80px and a cover at ~700px wide, so neither needs the
 *  2000px the event uploader keeps. But the runner can zoom in when framing, so
 *  keep enough pixels that a tight crop is still sharp. */
const MAX_EDGE: Record<PhotoKind, number> = { avatar: 1200, cover: 2000 };

/** Upload `file` under {userId}/{kind}-{ts}.{ext} and return its public URL.
 *  The first path segment must be the runner's own uid — that is what the
 *  owner-scoped storage RLS on profile-images checks.
 *
 *  The image is stored UNCROPPED. Framing lives in the URL fragment instead
 *  (see `withFraming`), so repositioning a photo later is free and lossless
 *  rather than a re-upload that can only ever crop further in. */
export async function uploadProfileImage(userId: string, kind: PhotoKind, file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Please choose a JPG, PNG, or WebP image.");

  const compressed = await imageCompression(file, {
    maxSizeMB: 2,
    maxWidthOrHeight: MAX_EDGE[kind],
    useWebWorker: true,
  });
  const ext = EXT[compressed.type] ?? EXT[file.type] ?? "jpg";

  // Timestamped rather than a fixed name: the public URL is CDN-cached, so
  // overwriting one path would keep serving the old photo after a change.
  const path = `${userId}/${kind}-${Date.now()}.${ext}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    contentType: compressed.type || file.type,
    upsert: true,
  });
  if (error) throw new Error(error.message);

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
