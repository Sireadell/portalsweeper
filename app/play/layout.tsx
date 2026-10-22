import type { Metadata } from "next";

export const metadata: Metadata = { title: "Play my Portals", description: "Connect the wallet that holds your Portals. Each Portal gets one ranked board a day." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
