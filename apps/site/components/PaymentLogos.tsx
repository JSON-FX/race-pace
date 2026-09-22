import Image from "next/image";

/**
 * Payment-method artwork for the pay screen.
 *
 * These are the providers' own files from public/payments/ — the same assets
 * the footer uses, so a runner sees one consistent mark for GCash on the
 * marketing chrome and on the screen where they actually pay. An earlier
 * version drew clean recreations inline as SVG to avoid a network request;
 * they were close but not the real logos, and having two different GCash
 * marks in one product is the kind of detail that reads as unfinished.
 *
 * The PNG marks ship with their own rounded plates, while QR Ph is the official
 * wide SVG. There is deliberately no extra CSS frame around either format.
 *
 * Sized by height with `width: auto` so every provider keeps its real aspect
 * ratio inside the payment-method row.
 */

const MARKS = {
  gcash: { src: "/payments/gcash.png", alt: "GCash", width: 506, height: 316 },
  maya: { src: "/payments/maya.png", alt: "Maya", width: 506, height: 316 },
  qrph: { src: "/payments/qr-ph.svg", alt: "QR Ph", width: 3000, height: 710 },
  visa: { src: "/payments/visa.png", alt: "Visa", width: 506, height: 316 },
  mastercard: { src: "/payments/mastercard.png", alt: "Mastercard", width: 506, height: 316 },
} as const;

type MarkKey = keyof typeof MARKS;

function Mark({ mark, height = 28 }: { mark: MarkKey; height?: number }) {
  const { src, alt, width, height: sourceHeight } = MARKS[mark];
  return (
    <Image
      src={src}
      // Every call site renders the provider's name as text beside this, so an
      // accessible name here would be announced twice.
      alt=""
      aria-hidden="true"
      title={alt}
      width={Math.round((height * width) / sourceHeight)}
      height={height}
      className="block w-auto"
      style={{ height }}
    />
  );
}

/** Logo(s) for a PayMongo method key, sized for the method rows. Card shows
 *  both scheme marks, matching mobile — "Card" alone doesn't tell a runner
 *  whether their Visa is accepted. */
export function MethodLogo({ methodKey, height = 24 }: { methodKey: string; height?: number }) {
  if (methodKey === "card") {
    return (
      <span className="flex items-center gap-1.5">
        <Mark mark="visa" height={height} />
        <Mark mark="mastercard" height={height} />
      </span>
    );
  }
  if (methodKey === "gcash") return <Mark mark="gcash" height={height} />;
  if (methodKey === "maya") return <Mark mark="maya" height={height} />;
  if (methodKey === "qrph") return <Mark mark="qrph" height={Math.min(height, 20)} />;
  return null;
}
