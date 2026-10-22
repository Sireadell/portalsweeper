import type { Metadata } from "next";

export const metadata: Metadata = { title: "Practice", description: "Endless Potsweeper boards with no wallet. Clear one and the next Pot is lined up." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
