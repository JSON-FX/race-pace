import { useRef, useState } from "react";
import { uploadEventImage } from "../lib/imageUpload";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

export type EventImagesValue = { hero_image_url: string | null; gallery: string[] };
const MAX = 8;

const roundBtn = "absolute h-[26px] w-[26px] rounded-full border-0 p-0 text-[13px] leading-[26px] text-white";

/** One image set for an event; the starred image is the featured (card) image.
 *  Controlled: on change it emits { hero_image_url: starred, gallery: the rest in order }. */
export function EventImagesEditor({ orgId, heroUrl, gallery, onChange }: {
  orgId: string;
  heroUrl: string | null;
  gallery: string[];
  onChange: (next: EventImagesValue) => void;
}) {
  const [pending, setPending] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const urls: string[] = Array.from(new Set([...(heroUrl ? [heroUrl] : []), ...gallery]));
  const featured = heroUrl ?? gallery[0] ?? null;

  const emit = (nextUrls: string[], nextFeatured: string | null) => {
    const hero = nextFeatured && nextUrls.includes(nextFeatured) ? nextFeatured : (nextUrls[0] ?? null);
    onChange({ hero_image_url: hero, gallery: nextUrls.filter((u) => u !== hero) });
  };

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    const room = MAX - urls.length - pending;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    // Accumulate locally: props don't update until React re-renders, so reading
    // `urls` after the first emit would be stale and clobber earlier uploads.
    let acc = [...urls];
    let feat = featured;
    for (const file of chosen) {
      setPending((n) => n + 1);
      try {
        const url = await uploadEventImage(orgId, file);
        acc = [...acc, url];
        if (!feat) feat = url;
        emit(acc, feat);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setPending((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  const remove = (url: string) => {
    const next = urls.filter((u) => u !== url);
    emit(next, url === featured ? (next[0] ?? null) : featured);
  };
  const star = (url: string) => emit(urls, url);

  const full = urls.length + pending >= MAX;

  return (
    <Card className="gap-0 p-[22px]">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold">Images</span>
        <span className="text-xs text-muted-foreground">{urls.length}/{MAX} · ★ = featured</span>
      </div>

      <div className="mt-3.5 grid grid-cols-3 gap-2.5">
        {urls.map((url) => (
          <div key={url} className="relative aspect-[4/3] w-full overflow-hidden rounded-[10px] border border-border bg-muted">
            <img src={url} alt="Event image" className="block h-full w-full object-cover" />
            <Button type="button" aria-label={url === featured ? "Featured image" : "Set as featured"}
              onClick={() => star(url)} disabled={pending > 0}
              className={`${roundBtn} top-1.5 left-1.5 ${url === featured ? "bg-primary" : "bg-black/50"} ${pending > 0 ? "opacity-50" : ""}`}>★</Button>
            <Button type="button" aria-label="Remove image"
              onClick={() => remove(url)} disabled={pending > 0}
              className={`${roundBtn} top-1.5 right-1.5 bg-black/50 text-[15px] ${pending > 0 ? "opacity-50" : ""}`}>×</Button>
            {url === featured ? (
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-primary px-[7px] py-[2px] text-[10px] font-bold text-primary-foreground">FEATURED</span>
            ) : null}
          </div>
        ))}
        {Array.from({ length: pending }).map((_, i) => (
          <div key={`p${i}`} className="flex aspect-[4/3] w-full items-center justify-center rounded-[10px] border border-border bg-muted">
            <span aria-label="Uploading" className="text-xs text-muted-foreground">Uploading…</span>
          </div>
        ))}
      </div>

      {!full && pending === 0 ? (
        <label className="mt-3 inline-block cursor-pointer text-[13px] font-semibold text-primary">
          + Add images
          <input ref={fileRef} type="file" accept="image/*" multiple aria-label="Add images"
            className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </label>
      ) : null}
      {err ? <div className="mt-2 text-xs text-destructive">{err}</div> : null}
    </Card>
  );
}
