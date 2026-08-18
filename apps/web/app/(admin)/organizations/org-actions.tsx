"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type OrgSummary = { id: string; name: string; slug: string; isActive: boolean };

const MESSAGES: Record<string, string> = {
  name_required: "Enter a name.",
  name_too_long: "That name is too long.",
  not_found: "That organization no longer exists.",
  forbidden: "Only a super admin can do that.",
  server_error: "Something went wrong. Please try again.",
};

/** functions.invoke surfaces a non-2xx as an error whose body still holds the
 *  code — the same unwrap new-org-dialog.tsx does, and the code is the entire
 *  diagnosis. */
async function callOrgProvision(body: Record<string, unknown>): Promise<{ data?: Record<string, unknown>; code?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("org-provision", { body });
  if (error || data?.error) {
    let code = data?.error as string | undefined;
    if (!code && error && "context" in error) {
      code = await (error as { context?: Response }).context?.clone().json()
        .then((b: { error?: string }) => b?.error).catch(() => undefined);
    }
    return { code: code ?? "server_error" };
  }
  return { data };
}

export function OrgActions({ org }: { org: OrgSummary }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [confirmingActive, setConfirmingActive] = useState(false);
  const [name, setName] = useState(org.name);
  const [busy, setBusy] = useState(false);

  async function rename() {
    setBusy(true);
    const { code } = await callOrgProvision({ action: "update", org_id: org.id, name: name.trim() });
    setBusy(false);
    if (code) return toast.error(MESSAGES[code] ?? MESSAGES.server_error);
    setRenaming(false);
    toast.success(`Renamed to ${name.trim()}.`);
    // The list is a Server Component — refresh, don't mutate local state.
    router.refresh();
  }

  async function setActive(next: boolean) {
    setBusy(true);
    const { code } = await callOrgProvision({ action: "set_active", org_id: org.id, is_active: next });
    setBusy(false);
    if (code) return toast.error(MESSAGES[code] ?? MESSAGES.server_error);
    setConfirmingActive(false);
    toast.success(next ? `${org.name} is live again.` : `${org.name} is suspended.`);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${org.name}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { setName(org.name); setRenaming(true); }}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmingActive(true)}>
            {org.isActive ? "Suspend" : "Unsuspend"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename organization</DialogTitle>
            <DialogDescription>
              The URL stays /{org.slug}. Slugs are fixed once an organization exists.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="org-rename">Name</Label>
            <Input id="org-rename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>Cancel</Button>
            <Button onClick={rename} disabled={busy || !name.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingActive} onOpenChange={setConfirmingActive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{org.isActive ? "Suspend" : "Unsuspend"} {org.name}?</DialogTitle>
            <DialogDescription>
              {org.isActive
                ? "Its events leave the runner site and it stops taking registrations. Entries already paid stay valid, and its team keeps console access."
                : "Its events return to the runner site and it can take registrations again."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingActive(false)}>Cancel</Button>
            <Button onClick={() => setActive(!org.isActive)} disabled={busy}>
              {org.isActive ? "Suspend" : "Unsuspend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
