import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Challenge a friend",
  description: "Send a link. You and a friend play the same hidden Portal board, and the faster clear wins.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
