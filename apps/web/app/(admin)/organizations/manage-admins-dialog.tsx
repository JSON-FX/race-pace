"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { OrgSummary } from "./org-actions";

type Member = { user_id: string; email: string | null; full_name: string | null; role: string };

/**
 * Who administers an organization, from the PLATFORM console.
 *
 * The org-members edge function has always accepted a super admin for any
 * org_id (index.ts:60) — it is the authorization boundary and it runs
 * regardless of what this dialog does. What was missing is reach: /team scopes
 * to requireOrgId(roles), which is null for a super admin with no org-scoped
 * row, so that page shows NoOrgScope and there was no other way in.
 */
export function ManageAdminsDialog({
  org, open, onOpenChange,
}: { org: OrgSummary; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  // Distinct from members === null ("still loading") — a failed fetch must
  // not leave the dialog stuck on "Loading…" forever with no way out.
  const [loadError, setLoadError] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // SMTP is not configured on this project, so an invite is only usable if the
  // operator can hand the link over themselves. `null` is "nothing to show
  // yet"; a successful invite that produced no link sets `""`, which is a
  // distinct state with its own copy — see the render below.
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("org-members", { body });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      throw new Error(
        status === 403 ? "You don't have permission to manage this team."
        : status === 409 ? "An organization must keep at least one admin."
        : status === 502 ? "Couldn't send the invite — try again."
        : "Something went wrong. Please try again.",
      );
    }
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const data = await call({ action: "list", org_id: org.id });
      setMembers((data as { members?: Member[] })?.members ?? []);
    } catch (e) {
      toast.error((e as Error).message);
      setLoadError(true);
    }
  }, [call, org.id]);

  useEffect(() => {
    // Reset before refetching, not just on success — otherwise the previous
    // org's rows (or a stale error) sit on screen until the new fetch lands.
    if (open) {
      setMembers(null);
      // A link belongs to the invite that produced it. Carrying one across a
      // reopen — or across a switch to a different org — would offer the
      // operator a sign-in link for the wrong person.
      setInviteLink(null);
      setCopied(false);
      load();
    }
  }, [open, load]);

  // Returns the response body on success and null on failure, so callers can
  // both decide what to do next (only clear the invite field on success) and
  // read what came back (the invite link) — `call` already threw and was
  // toasted by the time this returns null.
  async function run(body: Record<string, unknown>, done: string): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const data = await call(body);
      toast.success(done);
      await load();
      router.refresh();
      return (data as Record<string, unknown> | null) ?? {};
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Admins for {org.name}</DialogTitle>
          <DialogDescription>
            Invite the person who should run this organization, or remove someone who should not.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-destructive">Couldn't load the team.</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : members === null ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nobody can administer this organization yet.</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{m.full_name ?? m.email}</div>
                  {/* Only a second line when it says something the name line
                      didn't already — a null full_name falls back to email
                      above, so repeating it here would render it twice. */}
                  {m.full_name && (
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{m.role}</span>
                <Button
                  variant="ghost" size="sm" disabled={busy}
                  aria-label={`Remove ${m.email}`}
                  onClick={() => run(
                    { action: "remove", org_id: org.id, user_id: m.user_id },
                    `${m.email} removed.`,
                  )}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2">
          <Label htmlFor="org-invite-email">Email</Label>
          <div className="flex gap-2">
            <Input
              id="org-invite-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
            />
            <Button
              disabled={busy || !email.trim()}
              onClick={async () => {
                const trimmed = email.trim();
                const res = await run(
                  { action: "invite", org_id: org.id, email: trimmed, role: "admin" },
                  `Invite sent to ${trimmed}.`,
                );
                // A failed invite must leave the operator's typed address
                // in place — `run` already toasted the error, clearing the
                // field on top of that would make them retype it.
                if (!res) return;
                setEmail("");
                setCopied(false);
                // `?? ""` deliberately, not `?? null`: org-members answers ok
                // with invite_link: null when no link could be generated, and
                // that is a thing the operator must be TOLD, not a return to
                // "no invite has happened yet".
                setInviteLink((res.invite_link as string | null) ?? "");
              }}
            >
              Invite
            </Button>
          </div>

          {/* Mirrors new-org-dialog.tsx's post-create panel: the link is the
              only way an invited admin gets in until SMTP is configured. */}
          {inviteLink === null ? null : inviteLink ? (
            <div className="grid gap-1.5">
              <p className="text-[12px] text-muted-foreground">
                The invite email will arrive once SMTP is configured on this project. Until then,
                send them this sign-in link yourself.
              </p>
              <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-2.5">
                <code className="min-w-0 flex-1 truncate text-[12px]">{inviteLink}</code>
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(inviteLink);
                    setCopied(true);
                    toast.success("Link copied.");
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              The role was granted, but a sign-in link could not be generated. They will not be
              able to sign in until SMTP is configured or a link is sent from the
              organization&apos;s Team page.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
