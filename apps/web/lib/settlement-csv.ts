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

/**
 * RFC 4180 CSV cell escaping with formula injection prevention.
 *
 * Wraps in quotes and doubles any embedded quote when the value contains
 * comma, quote, newline, or carriage return. Additionally, prepends an
 * apostrophe if the value begins with a formula lead-in character (=, +, -,
 * @, tab, or carriage return). The apostrophe must be applied BEFORE RFC 4180
 * quoting so it sits inside the quotes; otherwise the spreadsheet still
 * executes the formula (quoting alone does not prevent this in Excel/Sheets).
 * The apostrophe is not displayed in the cell — it forces text interpretation.
 */
function cell(value: string): string {
  // Neutralize formula injection: prefix apostrophe if value starts with formula lead-in.
  if (/^[=+\-@\t\r]/.test(value)) {
    value = "'" + value;
  }
  // RFC 4180: wrap in quotes and escape embedded quotes.
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
