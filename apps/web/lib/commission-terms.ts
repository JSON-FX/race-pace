import { peso } from "@/lib/format";

/* ------------------------------------------------------------------ *
 * The commercial terms themselves
 * ------------------------------------------------------------------ */

/** The fee half of an organization's terms, mirroring `FeeTerms` in
 *  `supabase/functions/_shared/fee.ts`. The two must stay the same shape:
 *  every number this page shows is a prediction of what `computeFee` will
 *  strike on the next registration. */
export type FeeTerms = {
  commission_type: string;
  commission_rate: number | null;
  commission_flat_cents: number;
};

/** Fee + refund terms — one organization's whole commercial relationship,
 *  which is why both tables live on one page (design §7). */
export type RefundTerms = FeeTerms & {
  refund_policy: string;
  refund_fee_cents: number;
};

/**
 * The platform's commission on ONE registration, in centavos.
 *
 * A LINE-FOR-LINE PORT of `computeFee` in `supabase/functions/_shared/fee.ts`,
 * and it must stay one. This function never writes anything — it exists so the
 * page can show an operator what the server will do. If it drifts from the Deno
 * original, the page becomes a confident liar: it would quote a fee, the
 * organizer would agree to it, and confirmation would charge something else.
 *
 * The clamp in particular is not decoration. A flat fee above the entry price
 * would make `net_to_org` negative — the organizer owing money on a sale they
 * made — so `Math.min` floors it. That clamp is exactly what `flatFeeWarning`
 * below surfaces: the server silently absorbing a mis-set fee is correct
 * behaviour and a terrible thing to leave invisible.
 */
export function feeOn(total: number, terms: FeeTerms): number {
  if (total <= 0) return 0;
  if (terms.commission_type === "fixed") {
    return Math.min(terms.commission_flat_cents, total);
  }
  const rate = terms.commission_rate ?? 0.10;
  return Math.min(Math.round(total * rate), total);
}

/** Round-trip-safe to 6 decimal places. `0.085 * 100` happens to land on 8.5
 *  exactly, but neighbouring rates do not, and a rate rendered as
 *  `8.500000000000001` in an input box is how an operator ends up saving a
 *  number they never typed. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** DB fraction -> the percentage a human types. `0.10` -> `10`. */
export function rateToPercent(rate: number): number {
  return round6(rate * 100);
}

/**
 * The percentage a human types -> the DB fraction.
 *
 * THE DIRECTION OF THIS CONVERSION IS THE WHOLE POINT. `organizations.commission_rate`
 * is a fraction (`numeric(5,4)`, `0.10` meaning 10%). If the raw UI number ever
 * reached the column, a 10 would be a 1000% fee: `computeFee` would clamp it to
 * the entry total and the organizer would receive nothing on every registration.
 */
export function percentToRate(percent: number): number {
  return round6(percent / 100);
}

/* ------------------------------------------------------------------ *
 * Sentences the page is built to say
 * ------------------------------------------------------------------ */

/** Centavos with the centavos ALWAYS shown.
 *
 *  `peso()` (@/lib/format) deliberately hides `.00` so a table of round amounts
 *  reads cleanly. The refund example is the one place that must not: it splits
 *  one number into three, and `₱300 = ₱30 + ₱270` invites the reader to check
 *  the arithmetic, which only works if every term is shown at the same
 *  precision. A retained ₱300.50 splitting into ₱30 and ₱270 looks wrong even
 *  when it is right. */
function pesoExact(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos) / 100;
  return `${sign}₱${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `0.085` -> `"8.5%"`, `0.10` -> `"10.0%"`. One decimal: enough to tell 8.5%
 *  from 8%, few enough that a rate reads as a rate and not as an ID. */
function percentLabel(rate: number | null): string {
  return `${rateToPercent(rate ?? 0.10).toFixed(1)}%`;
}

/**
 * What one cancelling runner actually gets, in that org's own numbers.
 *
 * The policy NAMES hide the arithmetic that both parties care about — "flat_fee"
 * says nothing about who ends up with the retained money. Spelling it out is the
 * reason the refund table is on this page rather than behind a settings toggle.
 *
 * The retained amount is treated as a smaller sale: the org's normal commission
 * rule (`feeOn`, i.e. `computeFee`) runs against it, which is exactly what
 * `refund_registration_tx` does server-side. No new rule per refund, and the
 * payout statement picks it up with no special case.
 */
export function describeRefund(terms: RefundTerms, entryCents: number): string {
  if (terms.refund_policy === "none") {
    return "Refunds are not offered. The entry stands as a paid sale.";
  }
  if (terms.refund_policy === "full") {
    return `Gets all ${pesoExact(entryCents)} back. Neither the organizer nor Race Pace keeps anything.`;
  }
  // Clamped for the same reason `feeOn` clamps: a retention larger than the
  // entry cannot return negative money to the runner. It keeps the whole entry.
  const retained = Math.min(Math.max(terms.refund_fee_cents, 0), Math.max(entryCents, 0));
  const returned = Math.max(entryCents, 0) - retained;
  const commission = feeOn(retained, terms);
  const organizer = retained - commission;
  return (
    `Gets ${pesoExact(returned)} back. Of the ${pesoExact(retained)} retained, ` +
    `${pesoExact(commission)} is commission and ${pesoExact(organizer)} goes to the organizer.`
  );
}

/**
 * The same fee expressed the other way round, against the org's own average
 * entry. An operator comparing an offer ("we'll do ₱75 a head") to existing
 * terms ("you're on 10%") cannot do that in their head without knowing the
 * average entry price — so the row does it for them.
 */
export function describeFeeEquivalent(terms: FeeTerms, avgEntryCents: number): string {
  if (avgEntryCents <= 0) return "No paid entries yet to compare against";
  if (terms.commission_type === "fixed") {
    const pct = (terms.commission_flat_cents / avgEntryCents) * 100;
    return `≈ ${pct.toFixed(1)}% of a ${peso(avgEntryCents)} average entry`;
  }
  return `≈ ${peso(feeOn(avgEntryCents, terms))} on a ${peso(avgEntryCents)} average entry`;
}

/** The cheapest thing an org currently sells — the number a flat fee has to be
 *  measured against. */
export type CheapestCategory = { label: string; base_price: number };

/**
 * Names the entry a flat fee would swallow whole.
 *
 * `feeOn`/`computeFee` clamps the fee to the entry total, so nothing breaks and
 * nobody is told. That is precisely the problem: the organizer sells a ₱60 entry
 * and keeps ₱0 from it, and the operator who set the fee has no way to find out.
 * A percentage can never exceed the entry it is a percentage of, so this only
 * ever fires on `fixed`.
 */
export function flatFeeWarning(
  terms: FeeTerms,
  cheapest: CheapestCategory | null,
  orgName: string,
): string | null {
  if (terms.commission_type !== "fixed") return null;
  if (!cheapest) return null;
  if (terms.commission_flat_cents <= cheapest.base_price) return null;
  return (
    `${orgName}'s cheapest open category is the ${cheapest.label} at ${peso(cheapest.base_price)}. ` +
    `A ${peso(terms.commission_flat_cents)} flat fee exceeds it, so that entry earns the organizer nothing — ` +
    `the fee is clamped to the entry total so net_to_org never goes negative.`
  );
}

/**
 * ₱0 is never what anyone means.
 *
 * Both columns default to 0 because a NOT NULL integer needs a default, not
 * because zero is a sensible commercial term. A ₱0 flat commission earns the
 * platform nothing on every entry forever; a ₱0 retention makes `flat_fee`
 * behave identically to `full` while claiming to be a different policy. Neither
 * is invalid — an operator may genuinely want a free org — so this warns rather
 * than blocks.
 */
export function zeroFeeWarning(terms: FeeTerms): string | null {
  return terms.commission_type === "fixed" && terms.commission_flat_cents === 0
    ? "A ₱0 flat commission earns Race Pace nothing on every entry."
    : null;
}

/** The refund half of the same rule. Split from `zeroFeeWarning` because the
 *  two live in different tables — a single function returning whichever fired
 *  first would put a refund warning under the fee table. */
export function zeroRetentionWarning(policy: string, retentionCents: number): string | null {
  return policy === "flat_fee" && retentionCents === 0
    ? "A ₱0 retention is indistinguishable from a full refund."
    : null;
}

/** "a flat ₱75" / "8.5%" — how the terms being moved TO read in a sentence. */
function pendingPhrase(terms: FeeTerms): string {
  return terms.commission_type === "fixed"
    ? `a flat ${peso(terms.commission_flat_cents)}`
    : percentLabel(terms.commission_rate);
}

/** "₱75 flat" / "10.0%" — how the terms already frozen onto past payments read.
 *  Past tense, hence a different word order from `pendingPhrase`. */
function savedPhrase(terms: FeeTerms): string {
  return terms.commission_type === "fixed"
    ? `${peso(terms.commission_flat_cents)} flat`
    : percentLabel(terms.commission_rate);
}

/** Do these two terms describe a different fee? Only the ACTIVE half matters —
 *  a stale `commission_flat_cents` sitting behind a percentage fee changes
 *  nothing about what gets charged. */
function sameFee(a: FeeTerms, b: FeeTerms): boolean {
  if (a.commission_type !== b.commission_type) return false;
  return a.commission_type === "fixed"
    ? a.commission_flat_cents === b.commission_flat_cents
    : (a.commission_rate ?? 0.10) === (b.commission_rate ?? 0.10);
}

/**
 * THE SENTENCE THIS PAGE EXISTS FOR.
 *
 * The fee is struck once per registration and FROZEN onto the payment row at
 * confirmation (`supabase/functions/_shared/confirm.ts`). Changing an org's
 * commission therefore applies from the next registration onward and rewrites
 * nothing. That is correct for money and wildly counter-intuitive for anyone who
 * has ever changed a price in a settings screen — an operator who drops a rate
 * to settle a complaint will assume the existing entries were re-priced.
 *
 * Concrete numbers, not a general disclaimer: the org's name, the fee it is
 * moving to, and how many existing payments keep the old one. "Changes are not
 * retroactive" is read as boilerplate and skipped; "their 702 existing payments
 * keep the 10.0% they were charged at" is not.
 */
export function nonRetroactiveNotice(
  orgName: string,
  pending: FeeTerms,
  saved: FeeTerms,
  paidCount: number,
): string {
  const kept = `keep the ${savedPhrase(saved)} they were charged at.`;
  const count = paidCount.toLocaleString();
  if (sameFee(pending, saved)) {
    return paidCount > 0
      ? `Changing ${orgName}'s commission affects entries paid from now on. Their ${count} existing payments ${kept}`
      : `Changing ${orgName}'s commission affects entries paid from now on. Their existing payments ${kept}`;
  }
  return (
    `Switching ${orgName} to ${pendingPhrase(pending)} per registration affects entries paid from now on. ` +
    (paidCount > 0 ? `Their ${count} existing payments ${kept}` : `Their existing payments ${kept}`)
  );
}

/**
 * "Fee charged" for one event, read off the payments THEMSELVES rather than off
 * the org's current terms.
 *
 * Using the org's current terms here would quietly contradict the amber strip
 * above it: the whole page insists past payments keep the fee they were charged
 * at, so the by-event table must report what was actually frozen onto those
 * rows. An event that straddles a terms change honestly reads as blended.
 */
export function describeChargedFee(rows: { amount: number; platform_fee: number }[]): string {
  const paid = rows.filter((r) => r.amount > 0);
  if (paid.length === 0) return "—";
  const flat = paid[0].platform_fee;
  if (paid.every((r) => r.platform_fee === flat) && !paid.every((r) => r.amount === paid[0].amount)) {
    return `${peso(flat)} flat each`;
  }
  const rate = paid[0].platform_fee / paid[0].amount;
  if (paid.every((r) => Math.abs(r.platform_fee / r.amount - rate) < 0.0005)) {
    return `${(rate * 100).toFixed(1)}% each`;
  }
  const gross = paid.reduce((s, r) => s + r.amount, 0);
  const fee = paid.reduce((s, r) => s + r.platform_fee, 0);
  return `blended ${((fee / gross) * 100).toFixed(1)}%`;
}
