"use client";

import { useState } from "react";
import Image from "next/image";
import { TopoPattern } from "@/components/TopoPattern";

export function FieldnotesHero({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <TopoPattern className="h-full w-full" />;

  return <Image src={src} alt="" fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px" className="fieldnotes-race-card__image" onError={() => setFailed(true)} />;
}
