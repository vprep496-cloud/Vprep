import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Montserrat } from "next/font/google";
import Providers from "./providers";

// Phase 7 (Step 0): every Stitch export names "Montserrat" as the sole
// `fontFamily` for all text roles (loaded via a Google Fonts `<link>` in their
// raw HTML heads). `next/font/google` is the idiomatic Next.js equivalent —
// it self-hosts the font (no runtime request to Google Fonts, no layout
// shift) and exposes it as a CSS variable that `tailwind.config.js`'s
// `fontFamily.sans` now consumes.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "V-Prep Admin",
  description: "Admin portal for managing V-Prep candidates, tracks, and interview content.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body className="bg-background text-text-primary antialiased min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
