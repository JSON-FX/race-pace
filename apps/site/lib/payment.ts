/** Keys must match METHOD_MAP in supabase/functions/payment-session/index.ts —
 *  it rejects anything else. Maya is "paymaya" to PayMongo; the function maps it. */
export const PAY_METHODS = [
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
];

export const POLL_MS = 3000;
export const TIMEOUT_MS = 90_000;

export function breakdown(total: number, basePrice: number | null): { entry: number; addons: number } {
  const entry = basePrice ?? total;
  return { entry, addons: Math.max(0, total - entry) };
}
