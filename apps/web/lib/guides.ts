import { z } from "zod";

export const GUIDE_BUCKET = "guide-videos";
export const GUIDE_MAX_BYTES = 50 * 1024 * 1024;
export const GUIDE_URL_SECONDS = 3600;
export const GUIDE_TOPICS = ["Getting started", "Events", "Registrations", "Payments", "Race day", "Team & settings"] as const;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const guideInputSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Add a title.").max(160, "Keep the title within 160 characters."),
  description: z.string().trim().min(1, "Add a description.").max(2000, "Keep the description within 2,000 characters."),
  topic: z.enum(GUIDE_TOPICS),
  duration_seconds: z.number().int().min(1).max(14400),
  storage_path: z.string().regex(new RegExp(`^${uuid}/${uuid}\\.(mp4|webm)$`)),
  thumbnail_path: z.string().regex(new RegExp(`^${uuid}/${uuid}\\.jpg$`)).nullable(),
  is_published: z.boolean(),
}).superRefine((guide, ctx) => {
  for (const key of ["storage_path", "thumbnail_path"] as const) {
    if (guide[key] && !guide[key].startsWith(`${guide.id}/`)) ctx.addIssue({ code: "custom", path: [key], message: "The upload does not belong to this guide." });
  }
});
export type GuideInput = z.infer<typeof guideInputSchema>;
export type GuideVideo = GuideInput & { created_at: string; updated_at: string; thumbnailUrl?: string };

export function guideFileError(file: Pick<File, "type" | "size">): string | null {
  if (!["video/mp4", "video/webm"].includes(file.type)) return "Choose an MP4 or WebM video.";
  if (!file.size) return "This file is empty. Choose another video.";
  if (file.size > GUIDE_MAX_BYTES) return "Video must be 50 MiB or smaller. Choose a smaller file.";
  return null;
}

export function guideDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function filterGuides(guides: GuideVideo[], query: string, topic: string, sort: string): GuideVideo[] {
  const search = query.trim().toLocaleLowerCase();
  return guides.filter(g => (topic === "All guides" || g.topic === topic)
    && `${g.title} ${g.description} ${g.topic}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => sort === "az" ? a.title.localeCompare(b.title)
      : sort === "shortest" ? a.duration_seconds - b.duration_seconds
      : b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}
