"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
// From @/lib/org-slug, NOT @/lib/queries/organizations — that module imports
// the server Supabase client, and pulling it into a Client Component breaks
// `next build` outright ("next/headers ... only works in a Server Component").
import { normalizeSlug, isValidSlug } from "@/lib/org-slug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** org-provision's error codes, spelled out. A raw code in a toast tells the
 *  operator nothing about which field to fix. */
const MESSAGES: Record<string, string> = {
  unauthorized: "Your session expired — sign in again.",
  forbidden: "Only a super admin can create organizations.",
  name_required: "Enter the organization's name.",
  bad_slug: "That name doesn't produce a usable URL slug — type one manually.",
  bad_email: "Enter a valid email address for the first admin.",
  bad_commission: "Enter a valid commission.",
  zero_commission: "Set a commission above zero — the platform earns nothing on a ₱0 fee.",
  bad_refund_policy: "Choose a refund policy.",
  bad_refund_fee: "Enter a valid retention amount.",
  zero_retention: "A ₱0 retention is the same as a full refund — pick “Full refund” instead.",
  slug_taken: "That slug was taken while you were typing. Choose another.",
  invite_failed: "The organization wasn't created — the invite couldn't be sent.",
  role_failed: "The organization wasn't created — the admin role couldn't be assigned.",
  server_error: "Something went wrong. Please try again.",
};

type SlugState = { checking: boolean; available: boolean | null };

/**
 * Provisioning dialog. Calls `org-provision` directly from the browser with the
 * operator's own JWT — the function re-checks super_admin server-side, so this
 * is a relay, not an authorization layer (same arrangement as
 * lib/actions/team.ts and the org-members function).
 *
 * The slug is checked on BLUR rather than on submit. A slug collision found at
 * submit time means the operator has already filled in commercial terms and an
 * email, and the failure arrives attached to none of them.
 */
export function NewOrgDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Once the operator edits the slug themselves, typing in Name must stop
  // overwriting their work.
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ checking: false, available: null });
  const [email, setEmail] = useState("");
  const [commissionType, setCommissionType] = useState("percent");
  const [percent, setPercent] = useState("3");
  const [flatPesos, setFlatPesos] = useState("");
  const [refundPolicy, setRefundPolicy] = useState("full");
  const [retentionPesos, setRetentionPesos] = useState("");

  function reset() {
    setName(""); setSlug(""); setSlugTouched(false);
    setSlugState({ checking: false, available: null });
    setEmail(""); setCommissionType("percent"); setPercent("3"); setFlatPesos("");
    setRefundPolicy("full"); setRetentionPesos("");
    setError(null); setInviteLink(null); setCreatedName(""); setCopied(false);
  }

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(normalizeSlug(value));
      setSlugState({ checking: false, available: null });
    }
  }

  async function checkSlug() {
    const normalized = normalizeSlug(slug);
    if (normalized !== slug) setSlug(normalized);
    if (!isValidSlug(normalized)) {
      setSlugState({ checking: false, available: normalized === "" ? null : false });
      return;
    }
    setSlugState({ checking: true, available: null });
    const supabase = createClient();
    const { data, error: err } = await supabase.functions.invoke("org-provision", {
      body: { action: "check_slug", slug: normalized },
    });
    // A failed probe leaves availability UNKNOWN rather than green. The unique
    // constraint is the real guard and submit still surfaces `slug_taken`;
    // claiming "available" off a network error would be a promise this cannot
    // keep.
    setSlugState({ checking: false, available: err ? null : (data?.available ?? null) });
  }

  async function submit() {
    setBusy(true);
    setError(null);

    const normalized = normalizeSlug(slug || name);
    const body: Record<string, unknown> = {
      action: "create",
      name: name.trim(),
      slug: normalized,
      admin_email: email.trim().toLowerCase(),
      commission_type: commissionType,
      // The DB stores a fraction (0.10 = 10%). Rounded to 6 places so 8.5%
      // stores as 0.085 rather than 0.08499999999999999.
      commission_rate: commissionType === "percent"
        ? Number((Number(percent) / 100).toFixed(6))
        : null,
      commission_flat_cents: commissionType === "fixed" ? Math.round(Number(flatPesos) * 100) : 0,
      refund_policy: refundPolicy,
      refund_fee_cents: refundPolicy === "flat_fee" ? Math.round(Number(retentionPesos) * 100) : 0,
    };

    const supabase = createClient();
    const { data, error: err } = await supabase.functions.invoke("org-provision", { body });
    setBusy(false);

    // functions.invoke surfaces a non-2xx as an error whose body we still want:
    // the code in it is the entire diagnosis.
    if (err || data?.error) {
      let code = data?.error as string | undefined;
      if (!code && err && "context" in err) {
        code = await (err as { context?: Response }).context?.clone().json()
          .then((b: { error?: string }) => b?.error)
          .catch(() => undefined);
      }
      setError(MESSAGES[code ?? ""] ?? MESSAGES.server_error);
      return;
    }

    setCreatedName(data.org?.name ?? name.trim());
    setInviteLink(data.invite_link ?? null);
    toast.success(`${data.org?.name ?? "Organization"} created.`);
    // The list behind the dialog is a Server Component — refresh, don't mutate
    // local state, so the new row arrives with its real totals.
    router.refresh();
  }

  const flatPesosNum = Number(flatPesos);
  const percentNum = Number(percent);
  const retentionNum = Number(retentionPesos);
  const commissionOk = commissionType === "fixed"
    ? Number.isFinite(flatPesosNum) && flatPesosNum > 0
    : Number.isFinite(percentNum) && percentNum > 0 && percentNum <= 100;
  const refundOk = refundPolicy !== "flat_fee" || (Number.isFinite(retentionNum) && retentionNum > 0);
  const canSubmit = !busy && name.trim() !== "" && isValidSlug(normalizeSlug(slug || name))
    && email.trim() !== "" && commissionOk && refundOk;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New organization
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-xl sm:max-w-[460px]">
        {inviteLink !== null || createdName ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[17px] font-bold">{createdName} is live</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">
                An invite email went to <span className="font-semibold">{email}</span> — it will
                arrive once SMTP is configured on this project. Until then, send them this sign-in
                link yourself.
              </DialogDescription>
            </DialogHeader>

            {inviteLink ? (
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
            ) : (
              <p className="text-[13px] text-muted-foreground">
                The organization and its admin role were created, but a sign-in link could not be
                generated. Send the invite again from the organization&apos;s Team page.
              </p>
            )}

            <DialogFooter>
              <Button onClick={() => { setOpen(false); reset(); }}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-[17px] font-bold">New organization</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">
                Creates the organization and invites its first admin in one step. An organization
                nobody can sign in to cannot be set up at all.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3.5">
              <div className="grid gap-1.5">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name" value={name} autoComplete="off"
                  placeholder="Muspo Trail Series"
                  onChange={(e) => onNameChange(e.target.value)}
                  onBlur={() => { if (!slugTouched) void checkSlug(); }}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="org-slug">URL slug</Label>
                <Input
                  id="org-slug" value={slug} autoComplete="off" placeholder="muspo-trail-series"
                  onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); setSlugState({ checking: false, available: null }); }}
                  onBlur={() => void checkSlug()}
                  aria-describedby="org-slug-status"
                />
                <p id="org-slug-status" className="flex items-center gap-1 text-[12px] text-muted-foreground">
                  {slugState.checking ? (
                    <><Loader2 className="size-3 animate-spin" aria-hidden /> Checking…</>
                  ) : slugState.available === true ? (
                    <><Check className="size-3 text-paid" aria-hidden /> <span className="text-paid">{slug} is available</span></>
                  ) : slugState.available === false ? (
                    <><X className="size-3 text-destructive" aria-hidden /> <span className="text-destructive">
                      {isValidSlug(slug) ? "Already taken" : "Not a usable slug"}
                    </span></>
                  ) : (
                    "Checked when you leave the field."
                  )}
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="org-email">First admin</Label>
                <Input
                  id="org-email" type="email" value={email} autoComplete="off"
                  placeholder="organizer@email.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="org-commission-type">Commission</Label>
                  <Select value={commissionType} onValueChange={setCommissionType}>
                    <SelectTrigger id="org-commission-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Percentage</SelectItem>
                      <SelectItem value="fixed">Flat per entry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="org-commission-value">
                    {commissionType === "fixed" ? "Amount (₱)" : "Rate (%)"}
                  </Label>
                  {commissionType === "fixed" ? (
                    <Input
                      id="org-commission-value" type="number" min="1" step="1" inputMode="decimal"
                      className="tabular" value={flatPesos} placeholder="75"
                      onChange={(e) => setFlatPesos(e.target.value)}
                    />
                  ) : (
                    <Input
                      id="org-commission-value" type="number" min="0.1" max="100" step="0.1" inputMode="decimal"
                      className="tabular" value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                    />
                  )}
                </div>
              </div>

              {/* Not a style choice — the column defaults are `fixed` / ₱0, so an
                  operator who skips this field would create an organization Race
                  Pace earns nothing from. The function refuses it; this says why
                  before they hit that wall. */}
              {!commissionOk ? (
                <p className="text-[12px] text-destructive">
                  {commissionType === "fixed"
                    ? "Set a flat fee above ₱0 — the platform earns nothing otherwise."
                    : "Set a rate between 0 and 100%."}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="org-refund-policy">Refunds</Label>
                  <Select value={refundPolicy} onValueChange={setRefundPolicy}>
                    <SelectTrigger id="org-refund-policy" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full refund</SelectItem>
                      <SelectItem value="flat_fee">Keep a flat fee</SelectItem>
                      <SelectItem value="none">No refunds</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {refundPolicy === "flat_fee" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="org-retention">Retained (₱)</Label>
                    <Input
                      id="org-retention" type="number" min="1" step="1" inputMode="decimal"
                      className="tabular" value={retentionPesos} placeholder="300"
                      onChange={(e) => setRetentionPesos(e.target.value)}
                    />
                  </div>
                ) : null}
              </div>

              {refundPolicy === "flat_fee" && !refundOk ? (
                <p className="text-[12px] text-destructive">
                  A ₱0 retention is indistinguishable from a full refund — set an amount, or choose
                  &ldquo;Full refund&rdquo;.
                </p>
              ) : null}

              {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
            </div>

            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => { setOpen(false); reset(); }}>
                Cancel
              </Button>
              <Button disabled={!canSubmit} onClick={() => void submit()}>
                {busy ? "Creating…" : "Create and invite"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
