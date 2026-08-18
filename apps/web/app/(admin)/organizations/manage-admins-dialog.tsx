"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

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
    try {
      const data = await call({ action: "list", org_id: org.id });
      setMembers((data as { members?: Member[] })?.members ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [call, org.id]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Returns whether the call succeeded, so callers can decide what to do
  // next (e.g. only clear the invite field on success — see the invite
  // button below).
  async function run(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    try {
      await call(body);
      toast.success(done);
      await load();
      router.refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
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

        {members === null ? (
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
                const ok = await run(
                  { action: "invite", org_id: org.id, email: trimmed, role: "admin" },
                  `Invite sent to ${trimmed}.`,
                );
                // A failed invite must leave the operator's typed address
                // in place — `run` already toasted the error, clearing the
                // field on top of that would make them retype it.
                if (ok) setEmail("");
              }}
            >
              Invite
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
