import type { Metadata } from "next";

export const metadata: Metadata = { title: "Portal of the day", description: "One shared Portal board for everyone today. One ranked try per wallet; the fastest three clears earn SHARD, and 100 SHARD buys a Portal." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
