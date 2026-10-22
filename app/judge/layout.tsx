import type { Metadata } from "next";

export const metadata: Metadata = { title: "Judge mode", description: "Play any of the 500 Pots right now. No wallet. Each Pot's traits change the rules of its board." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
