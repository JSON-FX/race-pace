import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Race Pace", template: "%s · Race Pace" },
  description: "Trail and ultra-trail races in Mindanao, Philippines.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
