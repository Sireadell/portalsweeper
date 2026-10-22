import type { Metadata } from "next";

export const metadata: Metadata = { title: "Play my Pots", description: "Connect the wallet that holds your Pots. Each Pot gets one ranked board a day." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
