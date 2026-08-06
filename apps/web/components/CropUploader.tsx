"use client";

import { useCallback, useState, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { toast } from "sonner";
import { getCroppedBlob } from "@/lib/cropImage";
import { uploadOrgImage, type OrgImageKind } from "@/lib/org-upload";
import { updateOrgBrandingAction } from "@/lib/actions/settings";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
      const res = await updateOrgBrandingAction(orgId, { [field]: url });
      if (!res.ok) throw new Error(res.error);
      close();
      toast.success("Branding updated");
      onSaved();
    } catch (e) {
      setError((e as Error).message || "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-2 text-sm font-semibold">{label}</div>
      {currentUrl ? (
        <img src={currentUrl} alt={`Current ${label.toLowerCase()}`}
          className={`mb-2.5 block border border-border object-cover ${round ? "h-[72px] w-[72px] rounded-full" : "h-[90px] w-[234px] rounded-[10px]"}`} />
      ) : null}
      <label className="cursor-pointer text-[13px] font-semibold text-primary">
        Choose image
        <input type="file" accept="image/*" aria-label={`Choose ${label}`} onChange={onFile} className="hidden" />
      </label>

      <Dialog open={!!src} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent aria-label={`Crop ${label}`} className="w-auto max-w-none gap-3 p-6">
          <DialogTitle className="sr-only">{`Crop ${label}`}</DialogTitle>
          {src ? (
            <>
              <div className="relative h-80 w-80 overflow-hidden rounded-[10px] bg-black">
                <Cropper image={src} crop={crop} zoom={zoom} aspect={aspect} cropShape={round ? "round" : "rect"}
                  onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
              </div>
              {error ? <div role="alert" className="text-[13px] text-destructive">{error}</div> : null}
              <div className="flex justify-center gap-2">
                <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
                <Button type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
