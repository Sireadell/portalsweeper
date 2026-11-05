import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });

const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://portalsweeper.vercel.app";
const TITLE = "Portalsweeper: your Portal is the board";
const DESCRIPTION =
  "Every one of 500 Portals is its own daily minesweeper board. Its traits change the rules, clearing the board reveals the Portal's art, and the fastest clears of the Portal of the day earn SHARD, which buys a Portal NFT on Portaldot.";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: { default: TITLE, template: "%s | Portalsweeper" },
  description: DESCRIPTION,
  applicationName: "Portalsweeper",
  openGraph: { type: "website", siteName: "Portalsweeper", title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#14110F" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
