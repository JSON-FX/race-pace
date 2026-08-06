export type PixelCrop = { x: number; y: number; width: number; height: number };

/** Draw the cropped region of `imageSrc` (an object URL) onto a canvas and return a Blob.
 *  Canvas isn't reliably available in jsdom, so this is intentionally not unit-tested;
 *  it's mocked in the Branding page test and verified by review. */
export async function getCroppedBlob(imageSrc: string, crop: PixelCrop, type = "image/png"): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not process the image."))), type)
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = src;
  });
}
