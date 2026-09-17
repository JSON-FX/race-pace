/** Group quote arithmetic. SQL preparation is authoritative; these pure helpers
 * provide an independent oracle and the future capture-fee allocation contract. */
const MAX_CENTS = 2147483647;
function integer(value: number, max = MAX_CENTS): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error("invalid_money_input");
  return BigInt(value);
}
function cents(value: bigint): number {
  if (value < 0n || value > BigInt(MAX_CENTS)) throw new Error("order_amount_too_large");
  return Number(value);
}
export interface WeightedLine { id: string; weight: number }

/** Exact sums with stable UUID tie-breaking, independent of input order. A
 * zero-weight group can only receive zero; inventing an equal split hides errors. */
export function allocateCents(total: number, lines: WeightedLine[]): Map<string, number> {
  const amount = integer(total);
  if (!lines.length || new Set(lines.map((line) => line.id)).size !== lines.length) throw new Error("invalid_lines");
  const weights = lines.map((line) => ({ id: line.id, weight: integer(line.weight) }));
  const sum = weights.reduce((n, line) => n + line.weight, 0n);
  if (sum === 0n) {
    if (amount !== 0n) throw new Error("zero_allocation_weight");
    return new Map(weights.map((line) => [line.id, 0]));
  }
  const parts = weights.map((line) => ({ id: line.id, value: amount * line.weight / sum, remainder: amount * line.weight % sum }));
  let left = amount - parts.reduce((n, line) => n + line.value, 0n);
  parts.sort((a, b) => a.remainder === b.remainder ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (const part of parts) if (left > 0n) { part.value++; left--; }
  return new Map(parts.map((part) => [part.id, Number(part.value)]));
}
export interface GroupFeeTerms {
  fee_mode: "absorb" | "pass_on";
  commission_type: "fixed" | "percent";
  commission_bps: number;
  commission_flat_cents: number;
}
export interface GroupRate { percent_bps: number; fixed_cents: number }
export interface GroupQuoteLine {
  registration_id: string; base_cents: number; platform_fee_cents: number;
  processor_surcharge_cents: number; gross_cents: number;
  processor_fee_predicted_cents: number; net_to_org_predicted_cents: number;
}
export function quoteGroup(lines: { id: string; base_cents: number }[], terms: GroupFeeTerms, rate: GroupRate): {
  base_cents: number; platform_fee_cents: number; processor_surcharge_cents: number;
  gross_cents: number; processor_fee_predicted_cents: number; net_to_org_predicted_cents: number;
  lines: GroupQuoteLine[];
} {
  if (!lines.length || lines.length > 10 || new Set(lines.map((line) => line.id)).size !== lines.length) throw new Error("invalid_lines");
  if (!["absorb", "pass_on"].includes(terms.fee_mode) || !["fixed", "percent"].includes(terms.commission_type)) throw new Error("invalid_terms");
  const bps = integer(terms.commission_bps, 99999), flat = integer(terms.commission_flat_cents);
  const percent = integer(rate.percent_bps, 9999), fixed = integer(rate.fixed_cents);
  const entries = lines.map((line) => {
    const base = integer(line.base_cents);
    const fee = terms.commission_type === "fixed" ? flat : (base * bps + 5000n) / 10000n;
    return { id: line.id, base, fee: fee > base ? base : fee };
  });
  const base = entries.reduce((n, line) => n + line.base, 0n);
  const commission = entries.reduce((n, line) => n + line.fee, 0n);
  const target = terms.fee_mode === "pass_on" ? base + commission : base;
  const gross = base === 0n ? 0n : terms.fee_mode === "absorb" ? base : ((target + fixed) * 10000n + 9999n - percent) / (10000n - percent);
  const predicted = gross === 0n ? 0n : (gross * percent + 5000n) / 10000n + fixed;
  const surcharge = terms.fee_mode === "pass_on" ? gross - target : 0n;
  const extra = allocateCents(cents(surcharge), entries.map((line) => ({ id: line.id, weight: cents(terms.fee_mode === "pass_on" ? line.base + line.fee : line.base) })));
  const quoted = entries.map((line) => ({ registration_id: line.id, base_cents: cents(line.base), platform_fee_cents: cents(line.fee), processor_surcharge_cents: extra.get(line.id)!,
    gross_cents: cents(line.base + (terms.fee_mode === "pass_on" ? line.fee : 0n) + BigInt(extra.get(line.id)!)) }));
  const fees = allocateCents(cents(predicted), quoted.map((line) => ({ id: line.registration_id, weight: line.gross_cents })));
  return { base_cents: cents(base), platform_fee_cents: cents(commission), processor_surcharge_cents: cents(surcharge), gross_cents: cents(gross), processor_fee_predicted_cents: cents(predicted),
    net_to_org_predicted_cents: Number(gross - commission - predicted), lines: quoted.map((line) => ({ ...line, processor_fee_predicted_cents: fees.get(line.registration_id)!, net_to_org_predicted_cents: line.gross_cents - line.platform_fee_cents - fees.get(line.registration_id)! })) };
}
