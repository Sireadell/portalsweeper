import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { isChallengeId } from "@/lib/challenge";
import { hallNames } from "@/lib/hallNames";
import { PoolError, backEvent, eventView, getPoolStore, openEvent, raceFacts, resolveEvent, type PoolDeps } from "@/lib/predictions";
import { escrowWalletAddress, portaldotPoolChain } from "@/lib/poolPayout";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

const deps = (): PoolDeps => ({ store: getPoolStore(), chain: portaldotPoolChain(), races: getStore() });
const enabled = () => !!process.env.ESCROW_PRIVATE_KEY;

function escrowOrUndefined(): string | undefined {
  try {
    return escrowWalletAddress();
  } catch {
    return undefined;
  }
}

async function viewOf(d: PoolDeps, id: string) {
  const rec = await d.store.get(id);
  if (!rec) return null;
  const facts = await raceFacts(d.races, id, Date.now());
  const wallets = [rec.creator, facts.opponent ?? "", ...rec.backs.map((b) => b.wallet)].filter(Boolean);
  return eventView(rec, facts, await hallNames(wallets), escrowOrUndefined());
}

// GET ?id=RACE: the backing event of a race. Reading it also closes backing at the first move and pays or
// refunds a finished race, so the page shows the transaction without waiting for the timer.
// When nobody has opened backing yet the answer says whether this race could still take it.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!isChallengeId(id)) return NextResponse.json({ error: "That event does not exist." }, { status: 404 });
  if (!enabled()) return NextResponse.json({ error: "Backing is not switched on." }, { status: 503 });
  const d = deps();
  try {
    try {
      await resolveEvent(d, id);
    } catch (e) {
      console.error("pool resolve failed", id, e instanceof Error ? e.message : e); // shown on the next read
    }
    const event = await viewOf(d, id);
    if (event) return NextResponse.json({ event }, { headers: NO_STORE });
    const facts = await raceFacts(d.races, id, Date.now());
    if (!facts.exists) return NextResponse.json({ error: "That race does not exist." }, { status: 404 });
    return NextResponse.json({ event: null, race: { creator: facts.creator, canOpen: !facts.started && !facts.settled }, escrow: escrowOrUndefined() ?? null }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Could not load that event." }, { status: 500 });
  }
}

// { action: "open", id, address, signature }  the race creator opens backing (free signed message).
// { action: "back", id, wallet, side, txHash } a backer has sent tPOT to the pool wallet and passes the hash.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  if (!enabled()) return NextResponse.json({ error: "Backing is not switched on." }, { status: 503 });
  const d = deps();
  try {
    if (b.action === "open") {
      await openEvent(d, { id: b.id, address: b.address, signature: b.signature });
    } else if (b.action === "back") {
      await backEvent(d, { id: b.id, wallet: b.wallet, side: b.side, txHash: b.txHash });
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const event = await viewOf(d, String(b.id));
    return NextResponse.json({ event }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof PoolError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("predict failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
