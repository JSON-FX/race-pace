/**
 * Brand marks for the payment-method picker — the web counterpart of
 * apps/mobile/components/PaymentLogos.tsx, drawn with the same geometry and
 * the same hex values so the two apps read as one product.
 *
 * Inline SVG, no bundled files: nothing to load, crisp at any size, and no
 * layout shift while a logo fetches. As on mobile, these are clean
 * recreations of each brand's mark rather than the official artwork. To swap
 * in a provider's real logo, drop the file in public/ and render it here with
 * next/image — the call sites below are the only place that needs to change.
 *
 * Every mark is aria-hidden: each row already renders its label as text
 * ("GCash"), so an accessible name here would be announced twice.
 */

/** Visa — the italic wordmark in Visa blue. */
export function VisaMark({ height = 15 }: { height?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ fontSize: height, color: "#1434CB" }}
      className="font-extrabold italic leading-none tracking-[-0.5px]"
    >
      VISA
    </span>
  );
}

/** Mastercard — the interlocking red and amber discs. */
export function MastercardMark({ height = 16 }: { height?: number }) {
  return (
    <svg width={(height * 40) / 24} height={height} viewBox="0 0 40 24" aria-hidden="true">
      <circle cx={16} cy={12} r={11} fill="#EB001B" />
      <circle cx={26} cy={12} r={11} fill="#F79E1B" fillOpacity={0.9} />
    </svg>
  );
}

/** GCash — blue tile with the white "G" and its signal waves. */
export function GcashMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width={24} height={24} rx={7} fill="#1E88FF" />
      <path d="M15 9.2 a4.5 4.5 0 1 0 0 5.6" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M15 12 H11.2" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M16.7 9.9 a3.3 3.3 0 0 1 0 4.2" fill="none" stroke="#AFCDFF" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M18.2 8.7 a5 5 0 0 1 0 6.6" fill="none" stroke="#AFCDFF" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/** Maya — the lowercase wordmark in its spring-green, on a dark lockup so it
 *  keeps contrast against a light row (the green alone fails on white). */
export function MayaMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center rounded-[7px] px-[9px] py-[5px] text-[13px] font-extrabold leading-none tracking-[-0.3px]"
      style={{ backgroundColor: "#141414", color: "#1AE896" }}
    >
      maya
    </span>
  );
}

/** Logo(s) for a PayMongo method key, sized for the method rows. Card shows
 *  both scheme marks, matching mobile — "Card" alone doesn't tell a runner
 *  whether their Visa is accepted. */
export function MethodLogo({ methodKey }: { methodKey: string }) {
  if (methodKey === "card") {
    return (
      <span className="flex items-center gap-[7px]">
        <VisaMark height={15} />
        <MastercardMark height={16} />
      </span>
    );
  }
  if (methodKey === "gcash") return <GcashMark size={22} />;
  if (methodKey === "maya") return <MayaMark />;
  return null;
}
