import type { Metadata } from "next";
import { Archivo, Archivo_Narrow, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SiteFooter } from "@/components/SiteFooter";
import { RunnerTabBarSlot } from "@/components/RunnerTabBarSlot";

// Archivo carries the editorial-magazine headlines (oversized, tight
// tracking) while body copy stays on the system stack in globals.css —
// two distinct voices, not one font doing every job.
const archivo = Archivo({ subsets: ["latin"], weight: ["600", "800", "900"], variable: "--font-display" });
// A narrow condensed cut for eyebrows/labels, per the approved mockups.
const archivoNarrow = Archivo_Narrow({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-eyebrow" });
// Tabular figures for race data — distances, prices, cut-offs, checkpoint km.
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-mono-race" });

export const metadata: Metadata = {
  title: { default: "Race Pace", template: "%s · Race Pace" },
  description: "Trail and ultra-trail races in Mindanao, Philippines.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${archivoNarrow.variable} ${jetbrainsMono.variable}`}>
      {/* min-h-dvh + flex so the footer sits at the BOTTOM of a short page
          (sign-in, a one-line error) instead of floating under the fold. */}
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <div className="flex flex-1 flex-col">{children}</div>
          {/* Rendered here, not per page: six routes had silently shipped
              without it, and every new route would have had to remember. */}
          <SiteFooter />
          {/* After the footer, so it is the last element in the document and
              `sticky bottom-0` pins it to the viewport without taking the page
              out of normal flow — content still scrolls past it rather than
              ending underneath it. Renders nothing for a signed-out visitor. */}
          <RunnerTabBarSlot />
        </Providers>
      </body>
    </html>
  );
}
