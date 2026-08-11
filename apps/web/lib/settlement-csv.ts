/** One registration's money, as it appears in the settlement export. */
export type SettlementRow = {
  registration_id: string;
  runner_name: string;
  category: string;
  paid_at: string | null;
  method: string | null;
  /** All amounts are CENTAVOS in, PESOS out — see `peso` below. */
  gross_paid: number;
  rp_commission: number;
  processing_fee: number;
  net_to_org: number;
  status: string;
  refunded_amount: number;
  refunded_at: string | null;
};

const HEADER = [
  "registration_id", "runner_name", "category", "paid_at", "method",
  "gross_paid", "rp_commission", "processing_fee", "net_to_org",
  "status", "refunded_amount", "refunded_at",
] as const;

/** RFC 4180: wrap in quotes when the value contains a comma, quote or newline,
 *  and double any embedded quote. A single unescaped comma in a runner's name
 *  shifts every money column one place left for that row. */
function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Centavos to a plain decimal string. Never a currency symbol or thousands
 *  separator — both make the column text rather than a number on import. */
function peso(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The per-registration settlement export.
 *
 * Transaction-level ONLY. The summary lives on the page, where it can be
 * printed: a summary block above the header breaks every spreadsheet import,
 * and this file exists specifically to be opened in a spreadsheet.
 */
export function settlementCsv(rows: SettlementRow[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push([
      cell(r.registration_id),
      cell(r.runner_name),
      cell(r.category),
      cell(r.paid_at ?? ""),
      cell(r.method ?? ""),
      peso(r.gross_paid),
      peso(r.rp_commission),
      peso(r.processing_fee),
      peso(r.net_to_org),
      cell(r.status),
      peso(r.refunded_amount),
      cell(r.refunded_at ?? ""),
    ].join(","));
  }
  return lines.join("\n");
}
