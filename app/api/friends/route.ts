import { NextResponse } from "next/server";
import { getStore } from "@/lib/records";
import { answerRequest, claimUsername, getSocialStore, myFriends, requestFriend, sendInvite, unfriend, whoIs, type SocialDeps } from "@/lib/social";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

const deps = (): SocialDeps => ({ social: getSocialStore(), records: getStore() });

// { action, address, signature, ... }. The signature is the once-a-day sign-in text from lib/social-message.
// Actions: me, claim {name}, request {name}, accept {name}, decline {name}, remove {name},
// invite {name, challengeId}, dismiss {challengeId}.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400, headers: NO_STORE });
  }
  const d = deps();
  try {
    const who = await whoIs(d, b.address, b.signature);
    if (typeof who !== "string") return NextResponse.json({ error: who.error }, { status: who.status, headers: NO_STORE });
    let out: { ok: true; [k: string]: unknown } | { ok: false; status: number; error: string };
    switch (b.action) {
      case "me": out = { ok: true }; break;
      case "claim": out = await claimUsername(d, who, b.name); break;
      case "request": out = await requestFriend(d, who, b.name); break;
      case "accept": out = await answerRequest(d, who, b.name, true); break;
      case "decline": out = await answerRequest(d, who, b.name, false); break;
      case "remove": out = await unfriend(d, who, b.name); break;
      case "invite": out = await sendInvite(d, who, b.name, b.challengeId); break;
      case "dismiss":
        if (typeof b.challengeId === "string") await d.social.removeInvite(who, b.challengeId);
        out = { ok: true };
        break;
      default: return NextResponse.json({ error: "Unknown action." }, { status: 400, headers: NO_STORE });
    }
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json({ ...out, me: await myFriends(d, who) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Could not reach the friends list. Try again." }, { status: 500, headers: NO_STORE });
  }
}
