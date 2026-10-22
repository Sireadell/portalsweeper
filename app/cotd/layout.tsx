import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pot of the day", description: "One shared Pot board for everyone today. One ranked try per wallet; the fastest clear wins the Pot as a Portaldot NFT." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
