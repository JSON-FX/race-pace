import type { Metadata } from "next";
import { Archivo, Archivo_Narrow, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

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
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
