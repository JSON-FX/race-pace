import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Race Pace Admin",
  description: "Event organizer console",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "256x256" }],
    apple: [{ url: "/favicon.png", type: "image/png", sizes: "256x256" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required by next-themes: it writes the
    // `class` attribute on <html> before React hydrates, which would
    // otherwise log a mismatch on every load.
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body>
        {/* Light is the default on purpose. enableSystem is off because the only
            theme control in the app (components/ThemeToggle.tsx) is a binary
            light/dark switch with no way to pick "system" back, so following the
            OS only ever meant dark-OS users landing in dark with no default. */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
