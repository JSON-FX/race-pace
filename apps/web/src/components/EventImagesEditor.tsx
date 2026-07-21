import { useRef, useState } from "react";
import { uploadEventImage } from "../lib/imageUpload";

export type EventImagesValue = { hero_image_url: string | null; gallery: string[] };
const MAX = 8;

const card = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)", padding: 22 } as const;
const tile = { position: "relative" as const, width: "100%", aspectRatio: "4 / 3", borderRadius: 10, overflow: "hidden" as const, border: "1px solid var(--hairline)", background: "var(--parchment)" };
const round = (bg: string) => ({ position: "absolute" as const, border: 0, borderRadius: 999, width: 26, height: 26, cursor: "pointer", color: "#fff", background: bg, fontSize: 13, lineHeight: "26px", textAlign: "center" as const, padding: 0 });

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

  const urls: string[] = [...(heroUrl ? [heroUrl] : []), ...gallery];
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
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Images</span>
        <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{urls.length}/{MAX} · ★ = featured</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 14 }}>
        {urls.map((url) => (
          <div key={url} style={tile}>
            <img src={url} alt="Event image" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <button type="button" aria-label={url === featured ? "Featured image" : "Set as featured"}
              onClick={() => star(url)} style={{ ...round(url === featured ? "var(--primary)" : "rgba(0,0,0,0.5)"), top: 6, left: 6 }}>★</button>
            <button type="button" aria-label="Remove image"
              onClick={() => remove(url)} style={{ ...round("rgba(0,0,0,0.5)"), top: 6, right: 6, fontSize: 15 }}>×</button>
            {url === featured ? (
              <span style={{ position: "absolute", bottom: 6, left: 6, background: "var(--primary)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999 }}>FEATURED</span>
            ) : null}
          </div>
        ))}
        {Array.from({ length: pending }).map((_, i) => (
          <div key={`p${i}`} style={{ ...tile, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span aria-label="Uploading" style={{ fontSize: 12, color: "var(--ink-muted)" }}>Uploading…</span>
          </div>
        ))}
      </div>

      {!full ? (
        <label style={{ display: "inline-block", marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--primary)", cursor: "pointer" }}>
          + Add images
          <input ref={fileRef} type="file" accept="image/*" multiple aria-label="Add images"
            style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
        </label>
      ) : null}
      {err ? <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{err}</div> : null}
    </div>
  );
}
