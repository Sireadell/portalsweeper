import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { getDailySalt, utcToday } from "@/lib/salt";
import { readStoredRandom, usesChainRandom } from "@/lib/chainRandom";
import { hallNames } from "@/lib/hallNames";
import { shortWallet } from "@/lib/cotd";
import {
  broadcastMessage, getBroadcast, getKv, hashViewer, heartbeat, isCode, isLive, listBroadcasts, liveAnswer, recoverBroadcast,
  registerRanked, type LiveDeps,
} from "@/lib/broadcast";
import { generateBoard, getPortalMeta } from "../_deps";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
// Everyone watching one game shares one answer for a couple of seconds at the edge.
const EDGE = (s: number) => ({ "Cache-Control": `public, s-maxage=${s}, max-age=0` });

const tierOf = (m: { traits: { trait_type: string; value: string }[] }) => m.traits.find((t) => t.trait_type === "Tier")?.value;

function deps(): LiveDeps {
  const store = getStore();
  return {
    store,
    kv: getKv(),
    rankedBoard: async (tokenId, date, wallet) => {
      const random = usesChainRandom(date) ? (await readStoredRandom(date))?.value : undefined;
      return generateBoard(await getPortalMeta(tokenId), date, getDailySalt(date), random, wallet);
    },
    raceBoard: async (id) => {
      const c = await store.challengeGet(id);
      return c ? generateBoard(await getPortalMeta(c.tokenId), c.date, c.seed) : null;
    },
  };
}

// GET: the broadcasts running now. GET ?id=CODE: one broadcast, 15 seconds late, never a mine
// or a hidden number while a game runs.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  try {
    const now = Date.now();
    const d = deps();
    if (id === null) {
      const list = await listBroadcasts(d.kv, now);
      const walletsOf = async (b: (typeof list)[number]) =>
        b.wallet ? [b.wallet] : Object.values(await d.store.challengeEntries(b.code)).filter(Boolean).map((e) => e!.wallet);
      const perGame = await Promise.all(list.map(walletsOf));
      const names = await hallNames(perGame.flat());
      const rows = await Promise.all(
        list.map(async (b, i) => {
          const meta = await getPortalMeta(b.tokenId);
          return {
            code: b.code, kind: b.kind, tokenId: b.tokenId, portal: meta.name, image: meta.image, tags: b.tags,
            startedAt: b.startedAt, endedAt: b.endedAt ?? null,
            players: perGame[i].map((w) => ({ name: names.get(w) ?? null, wallet: shortWallet(w) })),
          };
        }),
      );
      return NextResponse.json({ serverNow: now, broadcasts: rows }, { headers: EDGE(5) });
    }
    if (!isCode(id)) return NextResponse.json({ error: "That broadcast does not exist." }, { status: 404, headers: EDGE(2) });
    const b = await getBroadcast(d.kv, id);
    if (!b || !isLive(b, now)) return NextResponse.json({ error: "That broadcast is over or never existed." }, { status: 404, headers: EDGE(2) });
    const out = await liveAnswer(d, b, now);
    if (!out) return NextResponse.json({ error: "That broadcast does not exist." }, { status: 404, headers: EDGE(2) });
    const names = await hallNames(out.seats.map((s) => s.wallet));
    const meta = await getPortalMeta(b.tokenId);
    const seats = out.seats.map((s) => ({ role: s.role, name: names.get(s.wallet) ?? null, wallet: shortWallet(s.wallet), view: s.view }));
    return NextResponse.json({ ...out, seats, portal: { id: meta.id, name: meta.name, image: meta.image } }, { headers: EDGE(2) });
  } catch {
    return NextResponse.json({ error: "Could not load the broadcast." }, { status: 500, headers: NO_STORE });
  }
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

// { action: "start", address, signature } opts today's ranked try in (one signed message, no gas).
// { action: "heartbeat", id } says a viewer tab is open: counted once per 10 seconds per hashed address.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400, headers: NO_STORE });
  }
  try {
    const now = Date.now();
    const d = deps();
    if (b.action === "heartbeat") {
      if (!isCode(b.id) || !(await getBroadcast(d.kv, b.id))) return NextResponse.json({ error: "That broadcast does not exist." }, { status: 404, headers: NO_STORE });
      const out = await heartbeat(d.kv, b.id, hashViewer(clientIp(req), utcToday(new Date(now))), now);
      return NextResponse.json({ viewers: out.viewers }, { headers: NO_STORE });
    }
    if (b.action === "start") {
      const date = utcToday(new Date(now));
      const { address, signature } = b;
      if (typeof address !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address))
        return NextResponse.json({ error: "Connect your wallet and sign to broadcast." }, { status: 400, headers: NO_STORE });
      let who: string;
      try {
        who = (await recoverBroadcast(broadcastMessage(date), signature)).toLowerCase();
      } catch {
        return NextResponse.json({ error: "Could not read that signature." }, { status: 401, headers: NO_STORE });
      }
      if (who !== address.toLowerCase()) return NextResponse.json({ error: "That signature does not match your wallet." }, { status: 401, headers: NO_STORE });
      const entry = await d.store.cotdEntry(date, who);
      if (!entry) return NextResponse.json({ error: "Start your ranked try first, then broadcast it." }, { status: 400, headers: NO_STORE });
      if (entry.finishedAt) return NextResponse.json({ error: "That ranked try is already over." }, { status: 409, headers: NO_STORE });
      const meta = await getPortalMeta(entry.tokenId);
      const tags = [tierOf(meta), "Ranked day", "Classic"].filter(Boolean) as string[];
      const out = await registerRanked(d.kv, { wallet: who, date, tokenId: entry.tokenId, tags, startedAt: entry.startedAt }, now);
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
      return NextResponse.json({ code: out.broadcast.code }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500, headers: NO_STORE });
  }
}
