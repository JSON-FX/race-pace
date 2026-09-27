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

// Storage uses the same multipart POST as the SDK. XHR exposes actual bytes sent.
async function uploadVideo(path: string, file: File, progress: (percent: number) => void): Promise<void> {
  const client = createClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error("Your session expired. Sign in again before uploading.");
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const fail = () => reject(new Error("Video upload failed. Check your connection and try again."));
    request.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) progress(Math.min(100, Math.floor(event.loaded / event.total * 100)));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) { progress(100); resolve(); }
      else fail();
    };
    request.onerror = fail;
    request.onabort = fail;
    request.open("POST", `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${GUIDE_BUCKET}/${path}`);
    request.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    request.setRequestHeader("Authorization", `Bearer ${data.session.access_token}`);
    request.setRequestHeader("x-upsert", "false");
    progress(0);
    request.send(body);
  });
}

export async function uploadGuideVideo(id: string, file: File, phase: (label: string) => void, progress: (percent: number) => void): Promise<UploadedGuide> {
  const error = guideFileError(file);
  if (error) throw new Error(error);
  phase("Reading video…");
  const media = await inspectVideo(file);
  const client = createClient();
  const uploadId = crypto.randomUUID();
  const storage_path = `${id}/${uploadId}.${file.type === "video/webm" ? "webm" : "mp4"}`;
  phase("Uploading video…");
  await uploadVideo(storage_path, file, progress);
  let thumbnail_path: string | null = null;
  if (media.thumbnail) {
    phase("Preparing thumbnail…");
    const path = `${id}/${uploadId}.jpg`;
    const thumbnail = await client.storage.from(GUIDE_BUCKET).upload(path, media.thumbnail, { contentType: "image/jpeg", upsert: false });
    if (!thumbnail.error) thumbnail_path = path;
  }
  return { storage_path, thumbnail_path, duration_seconds: media.duration };
}
