import { useCallback, useState, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { getCroppedBlob } from "../lib/cropImage";
import { uploadOrgImage, updateOrgBranding, type OrgImageKind } from "../lib/org";

export function CropUploader({ orgId, kind, aspect, field, label, currentUrl, round, onSaved }: {
  orgId: string;
  kind: OrgImageKind;
  aspect: number;
  field: "logo_url" | "banner_url";
  label: string;
  currentUrl: string | null;
  round?: boolean;
  onSaved: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (src) URL.revokeObjectURL(src);
      setSrc(URL.createObjectURL(file));
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPixels(null);
    }
    e.target.value = "";
  };

  function close() {
    if (src) URL.revokeObjectURL(src);
    setSrc(null);
    setPixels(null);
    setError(null);
  }
  const onCropComplete = useCallback((_a: Area, px: Area) => setPixels(px), []);

  async function save() {
    if (!src || !pixels) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(src, pixels);
      const url = await uploadOrgImage(orgId, blob, kind);
      const res = await updateOrgBranding(orgId, { [field]: url });
      if (!res.ok) throw new Error(res.error);
      close();
      onSaved();
    } catch (e) {
      setError((e as Error).message || "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {currentUrl ? (
        <img src={currentUrl} alt={`Current ${label.toLowerCase()}`}
          style={{ width: round ? 72 : 234, height: round ? 72 : 90, borderRadius: round ? "50%" : 10, objectFit: "cover", display: "block", marginBottom: 10, border: "1px solid var(--hairline)" }} />
      ) : null}
      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)", cursor: "pointer" }}>
        Choose image
        <input type="file" accept="image/*" aria-label={`Choose ${label}`} onChange={onFile} style={{ display: "none" }} />
      </label>

      {src ? (
        <div role="dialog" aria-label={`Crop ${label}`}
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ position: "relative", width: 320, height: 320, background: "#000", borderRadius: 10, overflow: "hidden" }}>
            <Cropper image={src} crop={crop} zoom={zoom} aspect={aspect} cropShape={round ? "round" : "rect"}
              onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
          </div>
          {error ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={close} disabled={busy} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--hairline)", background: "#fff", cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={busy} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
