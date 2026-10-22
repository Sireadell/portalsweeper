import type { Metadata } from "next";

export const metadata: Metadata = { title: "Practice", description: "Endless Portalsweeper boards with no wallet. Clear one and the next Portal is lined up." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
