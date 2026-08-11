"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { initials, peso } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  describeFeeEquivalent,
  describeRefund,
  flatFeeWarning,
  nonRetroactiveNotice,
  percentToRate,
  rateToPercent,
  zeroFeeWarning,
  zeroRetentionWarning,
  type FeeTerms,
  type RefundTerms,
} from "@/lib/commission-terms";
import { saveFeeTermsAction, saveRefundTermsAction, type TermsState } from "@/lib/actions/commission";
// TYPE-ONLY import: `@/lib/queries/commission` reaches `next/headers` through
// the Supabase server client, which is a build error in a Client Component.
// `import type` is erased before bundling, exactly as OrgSwitcher does with
// `OrgContext`.
import type { OrgCommissionRow } from "@/lib/queries/commission";

/* ------------------------------------------------------------------ *
 * Shared bits of the mockup's chrome
 * ------------------------------------------------------------------ */

/** The mockup's `.seg` — a compact segmented control. Radio semantics rather
 *  than buttons: this is a choice between mutually exclusive terms, and a
 *  keyboard user should be able to arrow between them. */
function Segmented<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-lg border bg-muted">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 text-[12px] font-bold transition-colors",
            value === o.value ? "bg-forest text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The mockup's `.rateinput` — a number with its unit attached, so `75` can
 *  never be misread as a percentage or `10` as pesos. */
function UnitInput({
  label, value, onChange, prefix, suffix, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center overflow-hidden rounded-lg border bg-card",
        "focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15",
        disabled && "opacity-50",
      )}
    >
      {prefix ? (
        <span className="border-r py-1 pl-2 pr-1 text-[12.5px] font-semibold text-muted-foreground">{prefix}</span>
      ) : null}
      <input
        aria-label={label}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-[62px] bg-transparent px-2 py-1 text-right text-[13px] font-semibold tabular-nums outline-none"
      />
      {suffix ? (
        <span className="border-l bg-muted py-1 pl-1.5 pr-2 text-[12.5px] font-semibold text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

/** The mockup's coloured explanatory strips at the foot of a card. They are not
 *  decoration: each one carries a consequence the table above it cannot show. */
function Strip({ tone, children }: { tone: "amber" | "destructive" | "info"; children: React.ReactNode }) {
  const tones = {
    amber: "bg-amber-tint text-amber",
    destructive: "bg-destructive-tint text-destructive",
    info: "bg-info-tint text-info",
  } as const;
  return (
    <div className={cn("flex items-start gap-2 border-t border-divider px-[14px] py-[11px] text-[12.5px] font-semibold", tones[tone])}>
      {tone === "info" ? (
        <Info className="mt-px size-[15px] shrink-0" strokeWidth={2.2} aria-hidden />
      ) : (
        <AlertTriangle className="mt-px size-[15px] shrink-0" strokeWidth={2.2} aria-hidden />
      )}
      <span>{children}</span>
    </div>
  );
}

function OrgCell({ name, caption }: { name: string; caption?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-forest text-[9.5px] font-extrabold text-white">
        {initials(name)}
      </span>
      <div>
        <div className="font-semibold">{name}</div>
        {caption ? <div className="text-[11px] font-normal text-muted-foreground">{caption}</div> : null}
      </div>
    </div>
  );
}

function Result({ state }: { state: TermsState }) {
  if (state.error) return <p className="mt-1 text-[11px] font-semibold text-destructive">{state.error}</p>;
  if (state.success) return <p className="mt-1 text-[11px] font-semibold text-paid">{state.success}</p>;
  return null;
}

const pesosOf = (cents: number): string => (cents / 100).toString();
const centsOf = (pesos: string): number => {
  const n = Number(pesos.trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};

/* ------------------------------------------------------------------ *
 * Fee per organization
 * ------------------------------------------------------------------ */

type FeeDraft = { type: string; percent: string; flat: string };

const feeDraftOf = (o: OrgCommissionRow): FeeDraft => ({
  type: o.commission_type,
  percent: String(rateToPercent(o.commission_rate ?? 0.10)),
  flat: pesosOf(o.commission_flat_cents),
});

/** What the draft would charge — the terms every warning on this card is
 *  computed against. Warnings must describe what the operator is ABOUT to save,
 *  not what is already saved, or the flat-fee clamp is only ever revealed after
 *  it has been committed. */
const pendingFee = (d: FeeDraft): FeeTerms => ({
  commission_type: d.type,
  commission_rate: percentToRate(Number(d.percent) || 0),
  commission_flat_cents: centsOf(d.flat),
});

const savedFee = (o: OrgCommissionRow): FeeTerms => ({
  commission_type: o.commission_type,
  commission_rate: o.commission_rate,
  commission_flat_cents: o.commission_flat_cents,
});

const sameDraft = (a: FeeDraft, b: FeeDraft) =>
  a.type === b.type && (a.type === "fixed" ? centsOf(a.flat) === centsOf(b.flat) : Number(a.percent) === Number(b.percent));

function FeeRow({ org, draft, onChange }: {
  org: OrgCommissionRow;
  draft: FeeDraft;
  onChange: (d: FeeDraft) => void;
}) {
  const [state, formAction, pending] = useActionState<TermsState, FormData>(saveFeeTermsAction, {});
  const dirty = !sameDraft(draft, feeDraftOf(org));

  return (
    <TableRow>
      <TableCell className="px-[14px] py-2.5">
        <OrgCell
          name={org.name}
          caption={`${org.event_count} event${org.event_count === 1 ? "" : "s"}${
            org.since ? ` · since ${new Date(org.since).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : ""
          }`}
        />
      </TableCell>
      <TableCell className="px-[14px] text-right tabular-nums">{org.paid_count.toLocaleString()}</TableCell>
      {/* The GMV column: charged_gross, not gross_revenue. See the header. */}
      <TableCell className="px-[14px] text-right tabular-nums">{peso(org.charged_gross)}</TableCell>
      <TableCell className="px-[14px] text-right font-semibold tabular-nums">{peso(org.platform_fee)}</TableCell>
      <TableCell className="px-[14px]">
        <Segmented
          label={`Fee type for ${org.name}`}
          value={draft.type}
          onChange={(type) => onChange({ ...draft, type })}
          options={[{ value: "percent", label: "%" }, { value: "fixed", label: "₱" }]}
        />
      </TableCell>
      <TableCell className="px-[14px]">
        <form action={formAction} id={`fee-${org.id}`}>
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="commission_type" value={draft.type} />
          {draft.type === "fixed" ? (
            <UnitInput
              label={`Flat fee in pesos for ${org.name}`}
              prefix="₱"
              value={draft.flat}
              onChange={(flat) => onChange({ ...draft, flat })}
            />
          ) : (
            <UnitInput
              label={`Commission percentage for ${org.name}`}
              suffix="%"
              value={draft.percent}
              onChange={(percent) => onChange({ ...draft, percent })}
            />
          )}
          {/* Submitted as hidden fields so the visible control can be one input
              while the action still receives an unambiguous, named value. */}
          <input type="hidden" name="commission_percent" value={draft.percent} />
          <input type="hidden" name="commission_flat_pesos" value={draft.flat} />
          <div className="mt-[3px] text-[11px] font-semibold text-muted-foreground">
            {describeFeeEquivalent(pendingFee(draft), org.avg_entry_cents)}
          </div>
          <Result state={state} />
        </form>
      </TableCell>
      <TableCell className="px-[14px] text-right">
        {/* `form=` rather than nesting: the button lives in its own cell, and a
            <form> may not span table cells. */}
        <Button
          type="submit"
          form={`fee-${org.id}`}
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || pending}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function FeeTermsTable({ orgs }: { orgs: OrgCommissionRow[] }) {
  const [drafts, setDrafts] = useState<Record<string, FeeDraft>>(
    () => Object.fromEntries(orgs.map((o) => [o.id, feeDraftOf(o)])),
  );
  const draftFor = (o: OrgCommissionRow) => drafts[o.id] ?? feeDraftOf(o);

  // The strip names ONE org, because a generic "changes are not retroactive"
  // reads as boilerplate and gets skipped. Which one: the row being edited if
  // there is one — that is the change the operator is about to make — otherwise
  // the org with the most existing payments, i.e. the one with the most money
  // riding on the rule.
  const edited = orgs.find((o) => !sameDraft(draftFor(o), feeDraftOf(o)));
  const focus = edited ?? [...orgs].sort((a, b) => b.paid_count - a.paid_count)[0];

  const flatWarnings = orgs
    .map((o) => flatFeeWarning(pendingFee(draftFor(o)), o.cheapest_open, o.name))
    .filter((w): w is string => w !== null);
  const zeroWarnings = orgs
    .map((o) => {
      const w = zeroFeeWarning(pendingFee(draftFor(o)));
      return w ? `${o.name}: ${w}` : null;
    })
    .filter((w): w is string => w !== null);

  return (
    <>
      <Table className="text-[12.5px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-[14px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Organization</TableHead>
            <TableHead className="h-9 px-[14px] text-right text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Paid entries</TableHead>
            <TableHead className="h-9 px-[14px] text-right text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">GMV</TableHead>
            <TableHead className="h-9 px-[14px] text-right text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Commission earned</TableHead>
            <TableHead className="h-9 px-[14px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Type</TableHead>
            <TableHead className="h-9 px-[14px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Per registration</TableHead>
            <TableHead className="h-9 px-[14px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.map((o) => (
            <FeeRow
              key={o.id}
              org={o}
              draft={draftFor(o)}
              onChange={(d) => setDrafts((prev) => ({ ...prev, [o.id]: d }))}
            />
          ))}
        </TableBody>
      </Table>

      {/* Persistent, not conditional. The fee is frozen onto each payment row at
          confirmation (_shared/confirm.ts), so this is true of every change made
          on this page — including the one the operator has not made yet. */}
      {focus ? (
        <Strip tone="amber">
          {nonRetroactiveNotice(focus.name, pendingFee(draftFor(focus)), savedFee(focus), focus.paid_count)}
        </Strip>
      ) : null}

      {flatWarnings.map((w) => (
        <Strip key={w} tone="destructive">
          <b className="font-extrabold">Flat fee vs. cheap entries.</b> {w} Shown here because a silent clamp is
          worse than a visible one.
        </Strip>
      ))}
      {zeroWarnings.map((w) => (
        <Strip key={w} tone="destructive">
          {w}
        </Strip>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Refund policy per organization
 * ------------------------------------------------------------------ */

type RefundDraft = { policy: string; retention: string };

const refundDraftOf = (o: OrgCommissionRow): RefundDraft => ({
  policy: o.refund_policy,
  retention: pesosOf(o.refund_fee_cents),
});

const pendingRefund = (o: OrgCommissionRow, d: RefundDraft): RefundTerms => ({
  refund_policy: d.policy,
  refund_fee_cents: centsOf(d.retention),
  // The SAVED fee terms, not the fee table's draft: the commission struck on a
  // retained amount is the org's real, committed rule. Reading an unsaved fee
  // edit from the other table would show a split that no refund would produce.
  commission_type: o.commission_type,
  commission_rate: o.commission_rate,
  commission_flat_cents: o.commission_flat_cents,
});

const sameRefund = (a: RefundDraft, b: RefundDraft) =>
  a.policy === b.policy && (a.policy !== "flat_fee" || centsOf(a.retention) === centsOf(b.retention));

function RefundRow({ org, draft, onChange }: {
  org: OrgCommissionRow;
  draft: RefundDraft;
  onChange: (d: RefundDraft) => void;
}) {
  const [state, formAction, pending] = useActionState<TermsState, FormData>(saveRefundTermsAction, {});
  const dirty = !sameRefund(draft, refundDraftOf(org));
  const terms = pendingRefund(org, draft);

  return (
    <TableRow>
      <TableCell className="px-[14px] py-2.5 align-top">
        <OrgCell name={org.name} />
      </TableCell>
      <TableCell className="px-[14px] align-top">
        <form action={formAction} id={`refund-${org.id}`}>
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="refund_policy" value={draft.policy} />
          <input type="hidden" name="refund_fee_pesos" value={draft.retention} />
          <Segmented
            label={`Refund policy for ${org.name}`}
            value={draft.policy}
            onChange={(policy) => onChange({ ...draft, policy })}
            options={[
              { value: "flat_fee", label: "Flat fee" },
              { value: "full", label: "Full" },
              { value: "none", label: "None" },
            ]}
          />
          <Result state={state} />
        </form>
      </TableCell>
      <TableCell className="px-[14px] align-top">
        {draft.policy === "flat_fee" ? (
          <UnitInput
            label={`Amount retained on a refund, in pesos, for ${org.name}`}
            prefix="₱"
            value={draft.retention}
            onChange={(retention) => onChange({ ...draft, retention })}
          />
        ) : (
          <span className="text-[12.5px] text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="max-w-[380px] whitespace-normal px-[14px] align-top text-[12px] leading-[1.5] text-muted-foreground">
        {org.example_entry_cents > 0 ? (
          <>
            <div>A runner cancelling a {peso(org.example_entry_cents)} entry:</div>
            <div className="text-foreground">{describeRefund(terms, org.example_entry_cents)}</div>
          </>
        ) : (
          "No paid entries or open categories yet to work an example from."
        )}
      </TableCell>
      <TableCell className="px-[14px] text-right align-top">
        <Button
          type="submit"
          form={`refund-${org.id}`}
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || pending}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function RefundTermsTable({ orgs }: { orgs: OrgCommissionRow[] }) {
  const [drafts, setDrafts] = useState<Record<string, RefundDraft>>(
    () => Object.fromEntries(orgs.map((o) => [o.id, refundDraftOf(o)])),
  );
  const draftFor = (o: OrgCommissionRow) => drafts[o.id] ?? refundDraftOf(o);

  const zeroWarnings = orgs
    .map((o) => {
      const d = draftFor(o);
      const w = zeroRetentionWarning(d.policy, centsOf(d.retention));
      return w ? `${o.name}: ${w}` : null;
    })
    .filter((w): w is string => w !== null);

  return (
    <>
      <Table className="text-[12.5px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-[14px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Organization</TableHead>
            <TableHead className="h-9 px-[14px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Policy</TableHead>
            <TableHead className="h-9 px-[14px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Retained</TableHead>
            <TableHead className="h-9 px-[14px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Worked example</TableHead>
            <TableHead className="h-9 px-[14px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.map((o) => (
            <RefundRow
              key={o.id}
              org={o}
              draft={draftFor(o)}
              onChange={(d) => setDrafts((prev) => ({ ...prev, [o.id]: d }))}
            />
          ))}
        </TableBody>
      </Table>

      {zeroWarnings.map((w) => (
        <Strip key={w} tone="destructive">
          {w}
        </Strip>
      ))}

      <Strip tone="info">
        <b className="font-extrabold">A retained fee is just a smaller sale.</b> The org&apos;s normal commission
        rule runs against the retained amount, so nothing new has to be decided per refund — and the payout
        statement picks it up with no special case. <b className="font-extrabold">None</b> refuses the refund
        outright, and the org admin&apos;s refund button is disabled with the reason rather than failing on submit.
      </Strip>
    </>
  );
}
