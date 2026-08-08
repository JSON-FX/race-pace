"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PHOTO_ASPECT, type Framing, type PhotoKind } from "@/lib/profileImage";

/** Drag to reposition, pinch or slide to zoom, then Save. Used both for a photo
 *  the runner just picked and for one already on their passport — the framing is
 *  stored separately from the image, so re-framing later costs nothing and never
 *  crops further into an already-cropped file. */
export function PhotoFramer({
  kind,
  src,
  initial,
  busy,
  onCancel,
  onSave,
}: {
  kind: PhotoKind;
  /** Object URL of a newly picked file, or the stored photo's URL. The caller
   *  mounts this component only while framing, so each session starts clean. */
  src: string;
  /** Where the runner left it last time, so reopening starts where they were. */
  initial: Framing | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (framing: Framing) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [framing, setFraming] = useState<Framing | null>(null);

  const onCropComplete = useCallback((area: Area) => setFraming(area), []);

  const noun = kind === "avatar" ? "profile photo" : "cover photo";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="gap-4 p-5 sm:max-w-md">
        <DialogTitle className="font-display text-[19px] font-black uppercase tracking-[-0.5px]">
          Position your {noun}
        </DialogTitle>
        <DialogDescription className="-mt-2 text-[13px]">
          Drag to move, zoom to fill the frame.
        </DialogDescription>

        {/* The crop box is the passport band's exact shape, so what the runner
            frames here is what the card shows. */}
        <div
          className="relative w-full overflow-hidden rounded-xl bg-black"
          style={{ aspectRatio: PHOTO_ASPECT[kind] }}
        >
          <Cropper
                image={src}
            crop={crop}
            zoom={zoom}
            minZoom={1}
            maxZoom={4}
            aspect={PHOTO_ASPECT[kind]}
            cropShape={kind === "avatar" ? "round" : "rect"}
            showGrid={kind === "cover"}
            objectFit="cover"
            // Reopening on an existing photo starts from its saved framing
            // rather than snapping back to centre.
            initialCroppedAreaPercentages={initial ?? undefined}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <label className="flex items-center gap-3">
          <span className="font-eyebrow text-[10px] font-bold uppercase tracking-[1.4px] text-muted-foreground">
            Zoom
          </span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="h-1 w-full cursor-pointer appearance-none rounded-pill bg-divider accent-primary"
          />
        </label>

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={busy || !framing}
            onClick={() => framing && onSave(framing)}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
