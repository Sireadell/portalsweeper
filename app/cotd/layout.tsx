import type { Metadata } from "next";

export const metadata: Metadata = { title: "Portal of the day", description: "One shared Portal board for everyone today. One ranked try per wallet; the fastest clear wins the Portal as a Portaldot NFT." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
