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
 * Each PNG ships with its own rounded plate, so there is deliberately no
 * border, background or radius applied here — a CSS chip would draw a second
 * frame around the one already in the artwork.
 *
 * Sized by height with `width: auto`, because the four files share a 506x316
 * frame but the marks inside them do not share an aspect ratio.
 */

const MARKS = {
  gcash: { src: "/payments/gcash.png", alt: "GCash" },
  maya: { src: "/payments/maya.png", alt: "Maya" },
  visa: { src: "/payments/visa.png", alt: "Visa" },
  mastercard: { src: "/payments/mastercard.png", alt: "Mastercard" },
} as const;

type MarkKey = keyof typeof MARKS;

function Mark({ mark, height = 28 }: { mark: MarkKey; height?: number }) {
  const { src, alt } = MARKS[mark];
  return (
    <Image
      src={src}
      // Every call site renders the provider's name as text beside this, so an
      // accessible name here would be announced twice.
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

/** Logo(s) for a PayMongo method key, sized for the method rows. Card shows
 *  both scheme marks, matching mobile — "Card" alone doesn't tell a runner
 *  whether their Visa is accepted. */
export function MethodLogo({ methodKey }: { methodKey: string }) {
  if (methodKey === "card") {
    return (
      <span className="flex items-center gap-1.5">
        <Mark mark="visa" />
        <Mark mark="mastercard" />
      </span>
    );
  }
  if (methodKey === "gcash") return <Mark mark="gcash" />;
  if (methodKey === "maya") return <Mark mark="maya" />;
  return null;
}
