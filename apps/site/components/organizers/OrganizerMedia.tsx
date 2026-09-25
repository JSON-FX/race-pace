"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { Organizer } from "@/lib/organizers";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase();
}

export function OrganizerPhoto({ src, className }: { src: string | null; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={`trail-atlas__photo ${className}`}>
      {src && !failed ? <Image src={src} alt="" fill sizes="(max-width: 700px) 100vw, 50vw" className="trail-atlas__photo-image" onError={() => setFailed(true)} /> : (
        <span className="trail-atlas__photo-fallback" aria-hidden="true">RP</span>
      )}
    </div>
  );
}

export function OrganizerMark({ organizer, large = false }: { organizer: Organizer; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [organizer.logoUrl]);
  return (
    <span className={`trail-atlas__mark${large ? " trail-atlas__mark--large" : ""}`} aria-hidden="true">
      {organizer.logoUrl && !failed ? <Image src={organizer.logoUrl} alt="" fill sizes={large ? "76px" : "52px"} className="trail-atlas__mark-image" onError={() => setFailed(true)} /> : initials(organizer.name)}
    </span>
  );
}
