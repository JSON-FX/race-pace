/** Profile photo framing.
 *
 *  A runner's avatar and cover are stored UNCROPPED in the profile-images
 *  bucket; how the photo is positioned inside its frame travels as a fragment
 *  on the stored URL (`https://…/avatar-123.jpg#c=x,y,w,h`).
 *
 *  Why a fragment: it is never sent to the server, so the stored value stays a
 *  working image URL for anything that doesn't know about framing — the mobile
 *  app renders it centre-cropped exactly as it always has — and repositioning a
 *  photo later rewrites four numbers instead of re-uploading a file that could
 *  only ever be cropped further in.
 *
 *  Lives in shared because the runner site WRITES this format and the admin
 *  console READS it. Two parsers for one string is how they drift. */

/** The visible window onto the stored image, as percentages of the full image —
 *  exactly what react-easy-crop reports as `croppedAreaPercentages`. */
export type Framing = { x: number; y: number; width: number; height: number };

/** The whole image, which is what an unframed photo shows. */
export const FULL_FRAME: Framing = { x: 0, y: 0, width: 100, height: 100 };

export type PhotoKind = "avatar" | "cover";

/** The shape of each photo's frame, shared by the cropper and every surface that
 *  renders one.
 *
 *  These MUST be the ratios the frames actually render at. Framing is a region
 *  of the source image with no aspect of its own, so `framedImageStyle` can only
 *  avoid distortion if the region was cut to the same shape as the box it ends
 *  up in — a cropper set to 16:9 over a 4:1 band squashes every photo. Avatars
 *  are square everywhere, which is why the admin console can apply a runner's
 *  saved framing without knowing anything about the site's layout. */
export const PHOTO_ASPECT: Record<PhotoKind, number> = { avatar: 1, cover: 2 };

/** Attach framing to a photo URL. A full-frame photo gets no fragment at all. */
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

/** CSS for the <img>: blow the image up so the framed region exactly fills its
 *  container, then slide it so that region is what shows. The container must be
 *  positioned and `overflow-hidden`.
 *
 *  The framed region carries the container's aspect ratio, so scaling both axes
 *  independently lands on the image's true proportions — no distortion. An
 *  unframed photo has no such guarantee, so it falls back to object-cover.
 *
 *  Returns a plain object rather than React's CSSProperties: this package stays
 *  framework-free, and the shape is structurally assignable to it anyway. */
export function framedImageStyle(framing: Framing): {
  position: "absolute";
  width: string;
  height: string;
  left?: string;
  top?: string;
  inset?: number;
  objectFit?: "cover";
  maxWidth?: "none";
} {
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
