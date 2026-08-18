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
import { ManageAdminsDialog } from "./manage-admins-dialog";

export type OrgSummary = { id: string; name: string; slug: string; isActive: boolean };

const MESSAGES: Record<string, string> = {
  name_required: "Enter a name.",
  name_too_long: "That name is too long.",
  not_found: "That organization no longer exists.",
  forbidden: "Only a super admin can do that.",
  server_error: "Something went wrong. Please try again.",
};

// delete-only codes on top of the shared MESSAGES map. not_found here means
// someone else deleted the same org first — the shared message already says that.
const DELETE_MESSAGES: Record<string, string> = {
  ...MESSAGES,
  org_has_payments: "This organization has taken payments. Suspend it instead.",
  slug_mismatch: "That slug doesn't match. Nothing was deleted.",
};

type Preview = {
  counts: Record<string, number>;
  blocked: boolean;
  blocking: { paid: number; refunded: number; partially_refunded: number } | null;
};

function settledTotal(p: Preview): number {
  const b = p.blocking;
  return b ? b.paid + b.refunded + b.partially_refunded : 0;
}

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
  const [deleting, setDeleting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  // A failed preview is distinct from "no preview yet" — it must never be
  // read as an all-clear. Keeps the confirm button disabled either way.
  const [previewFailed, setPreviewFailed] = useState(false);
  const [typedSlug, setTypedSlug] = useState("");

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

  async function openDelete() {
    setPreview(null);
    setPreviewFailed(false);
    setTypedSlug("");
    setDeleting(true);
    const { data, code } = await callOrgProvision({ action: "delete_preview", org_id: org.id });
    if (code) {
      // Do not close the dialog and do not fall back to zeros — a count
      // query that failed is not the same thing as an org with nothing in it.
      setPreviewFailed(true);
      return;
    }
    setPreview(data as unknown as Preview);
  }

  async function destroy() {
    setBusy(true);
    const { code, data } = await callOrgProvision({ action: "delete", org_id: org.id, slug: org.slug });
    setBusy(false);
    if (code) return toast.error(DELETE_MESSAGES[code] ?? MESSAGES.server_error);
    setDeleting(false);
    if (data?.storage_cleanup === "partial") {
      // The DB rows are gone but some uploaded files were not. `supabase
      // storage rm` is a silent no-op against the hosted project (legacy
      // service_role JWT vs. this project's sb_secret_ keys), so orphaned
      // files have no obvious cleanup path — a plain success toast would
      // leave nobody knowing they exist.
      toast.warning(`${org.name} deleted, but some of its uploaded files could not be removed and are still in storage.`);
    } else {
      toast.success(`${org.name} deleted.`);
    }
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
          <DropdownMenuItem onSelect={() => setManaging(true)}>
            Manage admins
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={openDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ManageAdminsDialog org={org} open={managing} onOpenChange={setManaging} />

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
                ? "Its events leave the runner site and it stops taking new registrations. Paid entries stay valid, and check-in, refunds and payouts keep working. Its team keeps console access."
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

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {org.name}?</DialogTitle>
            <DialogDescription>
              {previewFailed
                ? "The check failed. We don't know what this would affect yet."
                : preview?.blocked
                  ? "This cannot be deleted."
                  : "This cannot be undone. Everything below is destroyed."}
            </DialogDescription>
          </DialogHeader>

          {previewFailed ? (
            <p className="text-[13px] text-destructive">
              Could not check what this would delete. Try again — nothing was deleted.
            </p>
          ) : !preview ? (
            <p className="text-[13px] text-muted-foreground">Checking…</p>
          ) : preview.blocked ? (
            <p className="text-[13px]">
              {settledTotal(preview)} settled payments are attached to this organization.
              Deleting it would destroy the record of money that actually moved.
              Suspend it instead.
            </p>
          ) : (
            <>
              <ul className="text-[13px] text-muted-foreground">
                <li>{preview.counts.events} events</li>
                <li>{preview.counts.categories} categories</li>
                <li>{preview.counts.registrations} registrations</li>
                <li>{preview.counts.members} team members</li>
              </ul>
              <div className="grid gap-2">
                <Label htmlFor="org-del-slug">Type the slug ({org.slug}) to confirm</Label>
                <Input id="org-del-slug" value={typedSlug} onChange={(e) => setTypedSlug(e.target.value)} />
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={destroy}
              disabled={busy || !preview || preview.blocked || typedSlug !== org.slug}
            >
              Delete organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
