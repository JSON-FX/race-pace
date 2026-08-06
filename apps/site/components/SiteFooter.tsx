import Link from "next/link";
import Image from "next/image";

/**
 * Site footer. Server component — nothing here is interactive.
 *
 * The four payment marks are the providers' own artwork from
 * public/payments/, not the hand-drawn recreations in PaymentLogos.tsx. Those
 * exist because the checkout rows need a mark at 16–22px with zero network
 * cost; here the logos are large enough that the real files are worth the
 * bytes, and a footer is exactly where a runner looks to check "can I pay
 * with GCash before I start filling anything in".
 *
 * Each PNG ships with its own rounded plate, so there is deliberately no
 * border or background on the img — a CSS chip would draw a second frame
 * around the one already in the artwork.
 */

const PAYMENTS = [
  { src: "/payments/gcash.png", alt: "GCash" },
  { src: "/payments/maya.png", alt: "Maya" },
  { src: "/payments/visa.png", alt: "Visa" },
  { src: "/payments/mastercard.png", alt: "Mastercard" },
] as const;

const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Race",
    links: [
      { href: "/events", label: "All races" },
      { href: "/events?terrain=trail", label: "Trail & ultra" },
      { href: "/events?terrain=road", label: "Road & fun run" },
    ],
  },
  {
    heading: "Runners",
    links: [
      { href: "/races", label: "My races" },
      { href: "/profile", label: "Race passport" },
      { href: "/sign-in", label: "Sign in" },
    ],
  },
  {
    heading: "Organizers",
    links: [{ href: "/events", label: "List a race" }],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="no-print mt-24 border-t border-divider bg-muted/40">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            {/* The full lockup, wordmark included — the only place on the site
                that uses it. The header carries the mark alone so the two
                never read as a repeated logo. Source is 1177x760. */}
            <Image
              src="/footer-logo.png"
              alt="Race Pace"
              width={121}
              height={78}
              className="h-[70px] w-auto"
            />
            <p className="mt-4 max-w-[30ch] text-[13px] leading-relaxed text-muted-foreground">
              Trail and ultra-trail racing across Mindanao. Enter, pay, and carry your bib on your phone.
            </p>

            <p className="mt-6 font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground">
              We accept
            </p>
            <ul className="mt-3 flex flex-wrap items-center gap-2">
              {PAYMENTS.map((p) => (
                <li key={p.alt}>
                  <Image src={p.src} alt={p.alt} width={64} height={40} className="h-10 w-auto" />
                </li>
              ))}
            </ul>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h2 className="font-eyebrow text-[10.5px] font-bold uppercase tracking-[2px] text-muted-foreground">
                {col.heading}
              </h2>
              <ul className="mt-3 flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link
                      href={l.href}
                      className="text-[13.5px] text-foreground transition-colors hover:text-primary"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-10 border-t border-divider pt-6 font-mono-race text-[10px] uppercase tracking-[1px] text-muted-foreground">
          © {year} Race Pace · Cagayan de Oro, Philippines
        </p>
      </div>
    </footer>
  );
}
