"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";

export type WaiverPublishState = { error?: string; success?: string };
const inputSchema = z.object({
 orgId: z.string().uuid(), versionId: z.string().uuid(),
 title: z.string().trim().min(1).max(200),
 body: z.string().min(1).max(100000).refine(v => v.trim().length > 0),
 reviewed: z.literal("on"),
});
export async function publishWaiverAction(_: WaiverPublishState, form: FormData): Promise<WaiverPublishState> {
 const input = inputSchema.safeParse(Object.fromEntries(form));
 if (!input.success) return { error: "Enter a title and waiver text, then confirm you reviewed this version." };
 const roles = await getMyRoles();
 if (!roles?.isOrgAdmin || roles.orgId !== input.data.orgId) return { error: "Only this organization's admins can publish waivers." };
 const db = await createClient();
 const { data, error } = await db.rpc("organizer_publish_waiver", {
  p_org_id: input.data.orgId, p_version_id: input.data.versionId,
  p_title: input.data.title, p_body: input.data.body,
 });
 if (error || data !== input.data.versionId) return { error: "Could not publish this version. Please try again without changing the text." };
 revalidatePath("/settings");
 return { success: "Waiver version published. Select it for an event when ready." };
}

export async function selectEventWaiverAction(_: WaiverPublishState, form: FormData): Promise<WaiverPublishState> {
 const input = z.object({ orgId: z.string().uuid(), eventId: z.string().uuid(), waiverId: z.string().uuid() }).safeParse(Object.fromEntries(form));
 if (!input.success) return { error: "Choose an event and a published waiver." };
 const roles = await getMyRoles();
 if (!roles?.isOrgAdmin || roles.orgId !== input.data.orgId) return { error: "Only this organization's admins can select event waivers." };
 const db = await createClient();
 const { data: event } = await db.from("events").select("id").eq("id", input.data.eventId).eq("org_id", input.data.orgId).maybeSingle();
 if (!event) return { error: "Event unavailable for this organization." };
 const { error } = await db.rpc("event_select_waiver", { p_event_id: input.data.eventId, p_version_id: input.data.waiverId });
 if (error) return { error: "Could not update the event waiver. Please try again." };
 revalidatePath("/settings");
 return { success: "Event waiver updated. New registrations must accept this version." };
}
