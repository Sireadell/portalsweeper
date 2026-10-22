import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });

const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://potsweeper.vercel.app";
const TITLE = "Potsweeper: your Pot is the board";
const DESCRIPTION =
  "Every one of 500 Pots is its own daily minesweeper board. Its traits change the rules, clearing the board reveals the Pot's art, and the fastest clear of the Pot of the day wins it as an NFT on Portaldot.";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: { default: TITLE, template: "%s | Potsweeper" },
  description: DESCRIPTION,
  applicationName: "Potsweeper",
  openGraph: { type: "website", siteName: "Potsweeper", title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0814" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
