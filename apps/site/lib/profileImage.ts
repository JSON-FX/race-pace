"use client";

import type { CSSProperties } from "react";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "profile-images";
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type PhotoKind = "avatar" | "cover";

/** The shape of each photo's window, shared by the framer and the passport band.
 *
 *  These MUST be the ratios the band actually renders at. Framing is stored as
 *  a region of the source image with no aspect of its own, so `framedImageStyle`
 *  can only avoid distortion if the region was cut to the same shape as the box
 *  it ends up in — a cropper set to 16:9 over a 4:1 band squashes every photo. */
export const PHOTO_ASPECT: Record<PhotoKind, number> = { avatar: 1, cover: 2 };

/** An avatar is shown at 80px and a cover at ~700px wide, so neither needs the
 *  2000px the event uploader keeps. But the runner can zoom in when framing, so
 *  keep enough pixels that a tight crop is still sharp. */
const MAX_EDGE: Record<PhotoKind, number> = { avatar: 1200, cover: 2000 };

/** The visible window onto the stored image, as percentages of the full image —
 *  exactly what react-easy-crop reports as `croppedAreaPercentages`. */
export type Framing = { x: number; y: number; width: number; height: number };

/** The whole image, which is what an unframed photo shows. */
export const FULL_FRAME: Framing = { x: 0, y: 0, width: 100, height: 100 };

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

/** Attach framing to a photo URL as `#c=x,y,w,h`.
 *
 *  A fragment is never sent to the server, so the stored value is still a
 *  working image URL for anything that doesn't know about framing — the mobile
 *  app renders it centre-cropped, exactly as it does today. A full-frame
 *  photo gets no fragment at all. */
export function withFraming(url: string, framing: Framing): string {
  const bare = url.split("#")[0];
  const r = (n: number) => Math.round(n * 100) / 100;
  if (framing.width >= 100 && framing.height >= 100) return bare;
  return `${bare}#c=${r(framing.x)},${r(framing.y)},${r(framing.width)},${r(framing.height)}`;
}

/** Split a stored value back into the image URL and its framing. Anything
 *  unparseable — a plain URL, a photo set on mobile, a hand-edited value —
 *  falls back to the full frame rather than throwing. */
export function parsePhotoUrl(stored: string | null | undefined): { src: string; framing: Framing } | null {
  if (!stored) return null;
  const [src, hash = ""] = stored.split("#");
  if (!src) return null;

  const match = /^c=(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)$/.exec(hash);
  if (!match) return { src, framing: FULL_FRAME };

  const [x, y, width, height] = match.slice(1, 5).map(Number);
  if ([x, y, width, height].some((n) => !Number.isFinite(n)) || width <= 0 || height <= 0) {
    return { src, framing: FULL_FRAME };
  }
  return { src, framing: { x, y, width, height } };
}

/** Blow the image up so the framed region exactly fills its container, then
 *  slide it so that region is what shows. The container must be positioned and
 *  `overflow-hidden`.
 *
 *  The framed region always carries the container's aspect ratio (that is what
 *  react-easy-crop's `aspect` guarantees), so scaling both axes independently
 *  lands on the image's true proportions — no distortion. An unframed photo has
 *  no such guarantee, so it falls back to plain object-cover. */
export function framedImageStyle(framing: Framing): CSSProperties {
  if (framing.width >= 100 && framing.height >= 100) {
    return { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
  }
  return {
    position: "absolute",
    width: `${(100 / framing.width) * 100}%`,
    height: `${(100 / framing.height) * 100}%`,
    left: `${(-framing.x / framing.width) * 100}%`,
    top: `${(-framing.y / framing.height) * 100}%`,
    maxWidth: "none",
  };
}
