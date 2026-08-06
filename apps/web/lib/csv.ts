/** RFC 4180 field/row helpers shared by every CSV export route. One place
 *  for the escaping + injection-guard logic so the Registrations and
 *  Payments exports (and any future one) can't drift on how a comma, a
 *  quote, or a `=`-leading name gets handled — see the injection comment
 *  on `csvField` for why that guard exists at all. */

/** Leading characters that Excel, Google Sheets and most spreadsheet apps
 *  interpret as "this cell is a formula, not text" (OWASP "CSV Injection" /
 *  "Formula Injection"). Runner names, bib names and event names in this
 *  app are all user-supplied (the public registration form, org branding),
 *  so a name like `=HYPERLINK("https://evil","click me")` reaching a CSV
 *  unescaped would execute in whatever spreadsheet app opens our export. */
const FORMULA_LEAD_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Formats one CSV field: applies the formula-injection guard, then RFC 4180
 * quoting (comma, double-quote, newline, or leading/trailing whitespace all
 * force a quoted field with `""`-doubled internal quotes).
 *
 * Injection mitigation: prefix the value with a single quote `'` when it
 * starts with one of `FORMULA_LEAD_CHARS`. Every major spreadsheet app
 * treats a leading `'` as "force text" and does not render the quote
 * itself, so a genuine value that happens to start with one of these
 * characters (a "-5K Community Run" event name, say) still reads correctly
 * to a human — it just no longer parses as a formula. This is the standard
 * OWASP-recommended mitigation and is applied to every text field (names,
 * categories, methods) but deliberately NOT to the money/date fields in
 * this module, which are formatted as plain numeric/ISO tokens that can
 * never begin with one of these characters in a way a spreadsheet would
 * misinterpret (see `centavosToDecimal`'s and the export routes' own
 * comments).
 */
export function csvField(raw: string | null | undefined): string {
  let value = raw ?? "";
  if (value.length > 0 && FORMULA_LEAD_CHARS.has(value[0])) {
    value = `'${value}`;
  }
  const needsQuoting = /["\n\r,]/.test(value) || value !== value.trim();
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Joins already-`csvField`-ed values into one CRLF-terminated row. CRLF
 *  (not bare `\n`) per RFC 4180 — Excel on Windows in particular is fussy
 *  about bare `\n` between rows when the file is opened rather than
 *  imported. */
export function csvRow(fields: string[]): string {
  return fields.join(",") + "\r\n";
}

/**
 * Centavos -> a plain decimal string ("1500.00"), for a Money column.
 *
 * A raw decimal is more useful in a spreadsheet than `peso()`'s formatted
 * `₱1,500` string (from `@/lib/format`) — the latter is styled for on-screen
 * reading, and its thousands separator and currency glyph make the column
 * text rather than a number a spreadsheet can sum/chart. Emitted UNQUOTED
 * and un-guarded by `csvField`'s injection prefix: every amount in this
 * schema (`total_amount`, `amount`, `platform_fee`, `net_to_org`) is
 * non-negative, so the string always starts with a digit, never with one of
 * `FORMULA_LEAD_CHARS` — there is nothing here for a spreadsheet to
 * misinterpret as a formula. If a negative amount is ever introduced, revisit
 * this — a leading `-` on an otherwise-valid number is still parsed as a
 * number by every mainstream spreadsheet app (not a formula trigger), but a
 * future reader should not assume this file was written with that case in
 * mind for every possible column.
 */
export function centavosToDecimal(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sign}${(abs / 100).toFixed(2)}`;
}
