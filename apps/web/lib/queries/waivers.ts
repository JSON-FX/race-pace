import { createClient } from "@/lib/supabase/server";
export type WaiverVersion = { id: string; title: string; body: string; published_at: string };
export async function getWaiverVersions(orgId: string): Promise<WaiverVersion[]> {
 const db = await createClient();
 const { data, error } = await db.from("organizer_waiver_versions")
  .select("id,title,body,published_at").eq("org_id", orgId).order("published_at", { ascending: false });
 if (error) throw error;
 return data ?? [];
}
export type EventWaiverSetting = { id: string; name: string; waiver_version_id: string | null };
export async function getEventWaiverSettings(orgId: string): Promise<EventWaiverSetting[]> {
 const db = await createClient();
 const { data, error } = await db.from("events").select("id,name,waiver_version_id").eq("org_id", orgId).order("name");
 if (error) throw error;
 return data ?? [];
}
