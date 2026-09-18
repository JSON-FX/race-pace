import { formatPeso } from "@race-pace/shared";

/** Read the published terms, never infer refund eligibility from the entry price. */
export function RefundNotice({ policy, retention }: { policy?: string | null; retention?: number | null }) {
  const knownRetention = typeof retention === "number" && Number.isSafeInteger(retention) && retention >= 0;
  const message = policy === "none"
    ? "The organizer does not offer refunds for runner cancellations."
    : policy === "full"
      ? "If you cancel, your refund excludes payment processing fees and any Race Pace fee, labelled Taxes and fees when charged to you. There is no additional organizer cancellation fee."
      : policy === "flat_fee" && knownRetention
        ? `If you cancel, your refund excludes payment processing fees, any Race Pace fee (labelled Taxes and fees when charged to you), and an organizer cancellation fee of up to ${formatPeso(retention)}. The refund cannot be less than zero.`
        : "Refund terms are unavailable. Check with the organizer before paying.";
  return (
    <section aria-label="Refund policy" className="mt-6 rounded-xl border border-border bg-secondary px-5 py-4">
      <h2 className="text-[15px] font-semibold text-foreground">Refund policy</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{message}</p>
      {policy === "full" || policy === "flat_fee" ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Processing and Race Pace fees are retained even when the organizer covers them in the ticket price.
          The exact refund depends on the fees recorded for your payment. Contact the organizer to request a refund.
        </p>
      ) : null}
    </section>
  );
}
