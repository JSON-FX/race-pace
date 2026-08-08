"use client";

import { useState } from "react";
import { parsePhotoUrl, framedImageStyle } from "@race-pace/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** An avatar circle that shows a real photo when there is one and falls back to
 *  the initials monogram when there isn't.
 *
 *  Runners set their photo on the runner site, which stores it uncropped with
 *  the framing on the URL fragment. Avatar frames are square everywhere, so the
 *  runner's saved framing applies here unchanged — the admin sees the same crop
 *  of the same face the runner chose, not a blind centre crop.
 *
 *  A raw <img> rather than Radix's AvatarImage or next/image: the framing is
 *  explicit geometry (scale + offset) rather than object-fit, which AvatarImage's
 *  `aspect-square size-full` would override. That means handling the load failure
 *  ourselves — a photo whose storage object was deleted has to fall back to
 *  initials rather than leave a broken-image glyph in the middle of a table. */
export function PhotoAvatar({
  url,
  fallback,
  className,
  fallbackClassName,
}: {
  url: string | null | undefined;
  /** Initials, or whatever should show when there is no usable photo. */
  fallback: React.ReactNode;
  className?: string;
  fallbackClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  const photo = broken ? null : parsePhotoUrl(url);

  return (
    <Avatar className={cn("shrink-0", className)}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          style={framedImageStyle(photo.framing)}
        />
      ) : (
        <AvatarFallback className={fallbackClassName}>{fallback}</AvatarFallback>
      )}
    </Avatar>
  );
}
