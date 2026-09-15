"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TeamState = {
  error?: string;
  success?: string;
  warning?: string;
  inviteLink?: string;
};

/**
 * The
 * org-members edge function is where every real check happens (caller is
 * an org admin/super_admin, the role is assignable, the change wouldn't
 * leave the org with zero admins) — these Server Actions are a thin,
 * unprivileged relay to it, not a second authorization layer. Do not add a
 * client-only permission check here that could substitute for that: the
 * edge function is the actual gate, and it runs regardless of what this
 * relay does.
 */
async function errorMessage(error: unknown): Promise<string> {
  const payload = await (error as { context?: Response }).context
    ?.json?.()
    .catch(() => null);
  if (payload?.error === "invalid_event_scope")
    return "Choose an event in this organization. Only marshals and Race Kit staff can have an event restriction.";
  const status = (error as { context?: { status?: number } }).context?.status;
  return status === 403
    ? "You don't have permission to manage this team."
    : status === 409
      ? "An organization must keep at least one admin."
      : status === 502
        ? "Couldn't send the invite — try again."
        : status === 400
          ? "That role can't be assigned."
          : "Something went wrong. Please try again.";
}

export async function inviteMemberAction(
  _prev: TeamState,
  formData: FormData,
): Promise<TeamState> {
  const orgId = String(formData.get("orgId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (!orgId || !email) return { error: "Enter an email address." };

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("org-members", {
    body: {
      action: "invite",
      org_id: orgId,
      email,
      role,
      event_scope: formData.get("eventScope") || null,
    },
  });
  if (error) return { error: await errorMessage(error) };

  revalidatePath("/team");
  return deliveryFeedback(
    data,
    `Access saved. Sign-in email sent to ${email}.`,
  );
}

export async function changeRoleAction(
  userId: string,
  orgId: string,
  role: string,
  eventScope?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke("org-members", {
    body: {
      action: "setRole",
      org_id: orgId,
      user_id: userId,
      role,
      ...(eventScope !== undefined ? { event_scope: eventScope } : {}),
    },
  });
  if (error) return { ok: false, error: await errorMessage(error) };

  revalidatePath("/team");
  return { ok: true };
}

export async function removeMemberAction(
  userId: string,
  orgId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke("org-members", {
    body: { action: "remove", org_id: orgId, user_id: userId },
  });
  if (error) return { ok: false, error: await errorMessage(error) };

  revalidatePath("/team");
  return { ok: true };
}

function deliveryFeedback(
  data: { delivery?: string; invite_link?: string | null } | null,
  sent: string,
): TeamState {
  if (data?.delivery === "sent") return { success: sent };
  return {
    warning:
      "Access is saved, but the sign-in email was not sent. Retry sending." +
      (data?.invite_link
        ? " You can also share the one-time link privately."
        : ""),
    inviteLink: data?.invite_link ?? undefined,
  };
}

export async function resendMemberAction(
  userId: string,
  orgId: string,
): Promise<TeamState> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("org-members", {
    body: { action: "resend", org_id: orgId, user_id: userId },
  });
  if (error) return { error: await errorMessage(error) };
  return deliveryFeedback(data, "Sign-in email sent.");
}
