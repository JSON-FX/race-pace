import Image from "next/image";

/**
 * How a runner paid, for the admin Payments table.
 *
 * The artwork is the providers' own files, copied from apps/site/public/
 * payments/ into apps/web/public/payments/ so one GCash mark appears across
 * the product — the runner's checkout, the marketing footer and the
 * organizer's ledger all show the same logo.
 *
 * Each PNG ships with its own rounded plate, so there is deliberately no
 * border, background or radius applied here — a CSS chip would draw a second
 * frame around the one already in the artwork. Marks are sized by HEIGHT with
 * `width: auto`, because the four files share a 506x316 frame but the marks
 * inside them do not share an aspect ratio.
 *
 * `methodPresentation` is the whole mapping, kept pure and exported so the
 * rules below are unit-testable without a DOM.
 */

const MARKS = {
  gcash: { src: "/payments/gcash.png", alt: "GCash" },
  maya: { src: "/payments/maya.png", alt: "Maya" },
  visa: { src: "/payments/visa.png", alt: "Visa" },
  mastercard: { src: "/payments/mastercard.png", alt: "Mastercard" },
} as const;

export type MarkKey = keyof typeof MARKS;

export type MethodPresentation = {
  /** `known` — we recognise the instrument and have artwork for it.
   *  `unknown` — a method string we can't identify (see "paymongo" below).
   *  `unpaid`  — the payment has no method because it never completed. */
  kind: "known" | "unknown" | "unpaid";
  label: string;
  marks: MarkKey[];
};

// `payments.method` is a plain `text` column (supabase/migrations/
// 20260718183018_registrations_payments.sql:40), NOT an enum, and its values
// come from PayMongo's own `source.type` (supabase/functions/_shared/
// paymongo.ts:106, pmMethodFromAttributes) — an external vocabulary this repo
// does not control. So this table is "what we can name", never "everything
// that can appear": anything missing falls through to `unknown` below rather
// than being dropped or guessed at.
const KNOWN: Record<string, { label: string; marks: MarkKey[] }> = {
  // Card shows BOTH scheme marks, matching the public site and mobile —
  // "Card" alone doesn't tell an organizer whether a runner's Visa was
  // accepted. PayMongo reports the instrument, not the scheme, so which of
  // the two it actually was isn't knowable from this row.
  card: { label: "Card", marks: ["visa", "mastercard"] },
  gcash: { label: "GCash", marks: ["gcash"] },
  // PayMongo's source type is "paymaya"; the brand is now "Maya". Both spellings
  // map to the Maya artwork so a rename upstream doesn't blank the column.
  paymaya: { label: "Maya", marks: ["maya"] },
  maya: { label: "Maya", marks: ["maya"] },
  // Not written by the current confirm paths, but cheap to name if a scheme
  // ever arrives directly instead of as "card".
  visa: { label: "Visa", marks: ["visa"] },
  mastercard: { label: "Mastercard", marks: ["mastercard"] },
};

/**
 * The literal `"paymongo"` is the PROVIDER, not an instrument. It is what
 * `payment-verify` used to store on every redirect-confirmed payment, and what
 * `pmMethodFromAttributes` still falls back to when a session genuinely has no
 * `source.type`. The backfill migration (20260807090500_backfill_payment_
 * method.sql) recovered what it could from `payments.raw` and deliberately left
 * the unrecoverable rows reading "paymongo".
 *
 * So it must render as "Unknown". Showing it as a card — or as the PayMongo
 * brand, which looks like an answer — would state a fact about a runner's
 * payment that nobody actually knows.
 */
const UNKNOWN_METHOD = "paymongo";

/** The single mapping from a raw `payments.method` value to what the cell
 *  should show. Pure — no DOM, no React. */
export function methodPresentation(method: string | null | undefined): MethodPresentation {
  const key = (method ?? "").trim().toLowerCase();
  // A pending or failed payment has no method. A blank cell reads as a
  // rendering bug; "Not yet paid" states the actual fact.
  if (!key) return { kind: "unpaid", label: "Not yet paid", marks: [] };
  if (key === UNKNOWN_METHOD) return { kind: "unknown", label: "Unknown", marks: [] };
  const known = KNOWN[key];
  if (known) return { kind: "known", label: known.label, marks: known.marks };
  // An instrument PayMongo added since this file was written. Show the raw
  // value: the organizer sees exactly what the provider reported, which is
  // more useful than "Other" and is a searchable string when they ask us.
  return { kind: "unknown", label: method!.trim(), marks: [] };
}

// Filter options are ordered by how often an organizer will reach for them —
// the instruments runners actually use first, anything unrecognised after, and
// the "Unknown" legacy bucket last, since it is a data artefact rather than a
// choice a runner made.
const FILTER_ORDER = ["gcash", "card", "paymaya", "maya", "visa", "mastercard"];

/**
 * Build the Method filter's options from the values actually present in the
 * data, NOT from a hardcoded list. PayMongo can add instruments (`source.type`
 * is theirs, not ours), and a hardcoded list would both offer methods no runner
 * has ever used and silently hide the ones they have.
 */
export function methodFilterOptions(
  methods: readonly (string | null | undefined)[],
): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const raw of methods) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    // Dedupe on the normalised key so "GCash" and "gcash" are one option, but
    // keep the first spelling seen as the filter VALUE — it has to match the
    // column exactly for `.eq("method", value)` to select anything.
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  const rank = (key: string) => {
    if (key === UNKNOWN_METHOD) return FILTER_ORDER.length + 1;
    const i = FILTER_ORDER.indexOf(key);
    return i === -1 ? FILTER_ORDER.length : i;
  };
  return [...seen.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([, value]) => ({ value, label: methodPresentation(value).label }));
}

function Mark({ mark, height }: { mark: MarkKey; height: number }) {
  const { src, alt } = MARKS[mark];
  return (
    <Image
      src={src}
      // The label renders as text right beside this, so an accessible name
      // here would have a screen reader announce "GCash GCash". Same reasoning
      // as apps/site/components/PaymentLogos.tsx.
      alt=""
      aria-hidden="true"
      title={alt}
      width={Math.round((height * 506) / 316)}
      height={height}
      className="block w-auto"
      style={{ height }}
    />
  );
}

/** The Method cell: brand mark(s) plus the label. */
export function MethodBadge({ method, height = 18 }: { method: string | null | undefined; height?: number }) {
  const { kind, label, marks } = methodPresentation(method);
  return (
    <span className="flex items-center gap-1.5">
      {marks.map((mark) => (
        <Mark key={mark} mark={mark} height={height} />
      ))}
      <span className={kind === "known" ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}
