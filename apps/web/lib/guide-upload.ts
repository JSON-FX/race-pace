import { createClient } from "@/lib/supabase/client";
import { GUIDE_BUCKET, guideFileError } from "./guides";

export type UploadedGuide = { storage_path: string; thumbnail_path: string | null; duration_seconds: number };

async function inspectVideo(file: File): Promise<{ duration: number; thumbnail: Blob | null }> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    return await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("This video could not be read. Choose a compatible MP4 or WebM.")), 20000);
      const fail = (message: string) => { window.clearTimeout(timer); reject(new Error(message)); };
      video.onerror = () => fail("This video cannot play in this browser. Choose a compatible MP4 or WebM.");
      video.onloadedmetadata = () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 14400) {
          fail("Choose a playable video up to four hours long."); return;
        }
        video.currentTime = Math.min(1, video.duration / 2);
      };
      video.onseeked = () => {
        window.clearTimeout(timer);
        const duration = Math.max(1, Math.round(video.duration));
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 960;
          canvas.height = Math.max(1, Math.round(960 * video.videoHeight / video.videoWidth));
          if (canvas.height > 1920) { canvas.width = Math.max(1, Math.round(1920 * video.videoWidth / video.videoHeight)); canvas.height = 1920; }
          const context = canvas.getContext("2d");
          if (!context) { resolve({ duration, thumbnail: null }); return; }
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(thumbnail => resolve({ duration, thumbnail }), "image/jpeg", 0.8);
        } catch { resolve({ duration, thumbnail: null }); }
      };
      video.src = url;
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function uploadGuideVideo(id: string, file: File, phase: (label: string) => void): Promise<UploadedGuide> {
  const error = guideFileError(file);
  if (error) throw new Error(error);
  phase("Reading video…");
  const media = await inspectVideo(file);
  const client = createClient();
  const uploadId = crypto.randomUUID();
  const storage_path = `${id}/${uploadId}.${file.type === "video/webm" ? "webm" : "mp4"}`;
  phase("Uploading video…");
  const video = await client.storage.from(GUIDE_BUCKET).upload(storage_path, file, { contentType: file.type, upsert: false });
  if (video.error) throw new Error("Video upload failed. Check your connection and try again.");
  let thumbnail_path: string | null = null;
  if (media.thumbnail) {
    phase("Preparing thumbnail…");
    const path = `${id}/${uploadId}.jpg`;
    const thumbnail = await client.storage.from(GUIDE_BUCKET).upload(path, media.thumbnail, { contentType: "image/jpeg", upsert: false });
    if (!thumbnail.error) thumbnail_path = path;
  }
  return { storage_path, thumbnail_path, duration_seconds: media.duration };
}
