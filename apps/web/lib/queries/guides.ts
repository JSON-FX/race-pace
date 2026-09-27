import { createClient } from "@/lib/supabase/server";
import { GUIDE_BUCKET, GUIDE_URL_SECONDS, type GuideVideo } from "@/lib/guides";

export async function getGuides(): Promise<GuideVideo[]> {
  const supabase = await createClient();
  // RLS returns published rows to org admins and drafts to super admins.
  // Range through the API cap so an older guide never silently disappears.
  const guides: GuideVideo[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("guide_videos").select("id,title,description,topic,duration_seconds,storage_path,thumbnail_path,is_published,created_at,updated_at")
      .order("created_at", { ascending: false }).order("id").range(offset, offset + 499);
    if (error) { console.error("[guide] library read failed", error); throw new Error("Guides could not load."); }
    guides.push(...(data as GuideVideo[]));
    if (data.length < 500) break;
  }
  const paths = guides.flatMap(g => g.thumbnail_path ? [g.thumbnail_path] : []);
  if (paths.length) {
    const { data } = await supabase.storage.from(GUIDE_BUCKET).createSignedUrls(paths, GUIDE_URL_SECONDS);
    const urls = new Map(data?.map(s => [s.path, s.signedUrl]));
    guides.forEach(g => { if (g.thumbnail_path) g.thumbnailUrl = urls.get(g.thumbnail_path) || undefined; });
  }
  return guides;
}
