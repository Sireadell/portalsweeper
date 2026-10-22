import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dailyCommit, utcToday } from "@/lib/salt";
import { findCommit } from "@/lib/commits";
import { proofBadge } from "@/lib/proofBadge";
import { TIER_TABLE, DEFAULT_TIER } from "@/lib/engine";
import { formatTime, parseShareParams } from "@/lib/share";
import { getPotMeta } from "../_deps";

export const dynamic = "force-dynamic";

async function artDataUrl(id: number): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "pots", `${id}.webp`));
    // The card renderer does not read webp, so turn it into a png first.
    const { default: sharp } = await import("sharp");
    const png = await sharp(buf).resize(900, 900, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const p = parseShareParams({ token: q.get("token"), date: q.get("date"), time: q.get("time") });
  if (!p || p.date > utcToday()) return new Response("Bad card link.", { status: 400 });

  const name = `Pot #${p.token}`;
  let size = TIER_TABLE[DEFAULT_TIER];
  try {
    const meta = await getPotMeta(p.token);
    const tier = meta.traits.find((t) => t.trait_type === "Tier")?.value;
    if (tier && TIER_TABLE[tier]) size = TIER_TABLE[tier];
  } catch {
    return new Response("Unknown Pot.", { status: 404 });
  }
  const art = await artDataUrl(p.token);
  const post = await findCommit(p.date).catch(() => undefined);
  const badge = proofBadge({ date: p.date, token: p.token, commit: dailyCommit(p.date), posted: Boolean(post?.txHash) });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0c0916", color: "#ece9fb", padding: "50px 60px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#836ef9" }}>Potsweeper</div>
          <div style={{ display: "flex", fontSize: 32, color: "#8bf5c0", fontWeight: 700 }}>BOARD CLEARED</div>
        </div>
        <div style={{ display: "flex", marginTop: 30, alignSelf: "center", width: 912, height: 912, borderRadius: 40, overflow: "hidden", border: "6px solid #836ef9", background: "#16112a" }}>
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art} width={900} height={900} alt="" style={{ objectFit: "cover" }} />
          ) : (
            <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", fontSize: 200, color: "#836ef9" }}>#{p.token}</div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 24 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 54, fontWeight: 800 }}>{name}</div>
            <div style={{ display: "flex", fontSize: 30, color: "#b9b2e0", marginTop: 6 }}>
              Token #{p.token}, {size.cols}x{size.rows} board, {size.mines} mines, {p.date}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 24, color: "#b9b2e0" }}>CLEAR TIME</div>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: "#8bf5c0" }}>{formatTime(p.time)}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 18, padding: "12px 20px", border: "2px solid #3d6b5a", borderRadius: 18, background: "#101f1c" }}>
          <div style={{ display: "flex", fontSize: 24, color: "#8bf5c0", fontWeight: 700 }}>
            {`${badge.headline}:  ${badge.fingerprint}`}
          </div>
          <div style={{ display: "flex", fontSize: 19, color: "#9a93c4", marginTop: 4 }}>
            {`${post?.txHash ? "Fingerprint posted on Portaldot before the day ended." : "Fingerprint set for the day."} Check: potsweeper.vercel.app${badge.verifyPath}`}
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
