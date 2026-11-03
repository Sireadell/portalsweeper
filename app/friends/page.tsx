import type { Metadata } from "next";
import FriendsPanel from "@/components/FriendsPanel";

export const metadata: Metadata = { title: "Friends", description: "Pick a username, add friends and challenge them to a Portalsweeper race." };

export default function FriendsPage() {
  return (
    <main className="page-narrow">
      <section className="mx-auto max-w-[720px] pt-2">
        <p className="eyebrow">Player vs player</p>
        <h1 className="mb-2 mt-2 text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Friends</h1>
        <p className="mb-5 text-[15px] text-text2">Add friends by username, then challenge them to the same hidden board. Their invite waits for them here.</p>
        <FriendsPanel />
      </section>
    </main>
  );
}
