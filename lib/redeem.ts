// Redeem 100 SHARD for one Portal. The player signs a free message (no gas). The server checks it, then the
// issuer sends ONE transaction: take the 100 SHARD, burn it, mint the chosen Portal to the player, write its traits, write a note.
// If the player no longer holds 100 SHARD the take step fails and nothing else in the transaction happens.
import { keccak256, recoverMessageAddress, toBytes, type Hex } from "viem";
import { PORTAL_SUPPLY } from "./types";
import { utcToday } from "./salt";
import { burnedKey } from "./shardAward";
import { REDEEM_PRICE, redeemMessage } from "./redeemMessage";
import type { Kv } from "./shardKv";

export { REDEEM_PRICE, redeemMessage };
export const REDEEMS_PER_DAY = 3; // testnet limit: each Portal locks about 11 tPOT of the issuer's coins
export const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

export const sigHash = (signature: string) => keccak256(toBytes(signature.toLowerCase())).slice(0, 18); // short fingerprint for the note

export type RedeemDeps = {
  kv: Kv;
  now?: () => number;
  recover?: (message: string, signature: string) => Promise<string>;
  portalOwner: (id: number) => Promise<string | null>; // native owner, null when not minted
  shardBalance: (wallet: string) => Promise<number>;
  send: (o: { wallet: string; portal: number; note: string }) => Promise<{ txHash: string; block: number }>;
};

export type RedeemResult =
  | { ok: true; portal: number; txHash: string; block: number; again?: boolean }
  | { ok: false; status: number; error: string };

const recoverDefault = (message: string, signature: string) => recoverMessageAddress({ message, signature: signature as Hex });
const portalKey = (id: number) => `redeem:portal:${id}`;
const sigKey = (h: string) => `redeem:sig:${h}`;
const dayKey = (d: string) => `redeem:day:${d}`;
export const redeemLogKey = "redeem:log"; // JSON list of finished redeems, newest last

export type RedeemRecord = { portal: number; wallet: string; txHash: string; block: number; at: number };

export async function redeem(deps: RedeemDeps, input: { address: unknown; signature: unknown; portal: unknown; issuedAt: unknown }): Promise<RedeemResult> {
  const now = (deps.now ?? Date.now)();
  const portal = Number(input.portal);
  if (!Number.isInteger(portal) || portal < 1 || portal > PORTAL_SUPPLY) return { ok: false, status: 400, error: `Pick a Portal from 1 to ${PORTAL_SUPPLY}.` };
  if (typeof input.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input.address) || typeof input.signature !== "string")
    return { ok: false, status: 400, error: "Connect your wallet and sign to redeem." };
  const issuedAt = Number(input.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > SIGNATURE_WINDOW_MS) return { ok: false, status: 400, error: "That signature is too old. Sign again." };

  let who: string;
  try {
    who = (await (deps.recover ?? recoverDefault)(redeemMessage(portal, issuedAt), input.signature)).toLowerCase();
  } catch {
    return { ok: false, status: 401, error: "Could not read that signature." };
  }
  if (who !== input.address.toLowerCase()) return { ok: false, status: 401, error: "That signature does not match your wallet." };

  // The same signature never works twice: a repeat gets the first answer back.
  const sh = sigHash(input.signature);
  if (!(await deps.kv.setnx(sigKey(sh), JSON.stringify({ state: "running", at: now })))) {
    const prev = JSON.parse((await deps.kv.get(sigKey(sh))) ?? "null") as { state: string; portal?: number; txHash?: string; block?: number } | null;
    if (prev?.state === "done" && prev.txHash) return { ok: true, portal: prev.portal ?? portal, txHash: prev.txHash, block: prev.block ?? 0, again: true };
    return { ok: false, status: 409, error: "That request is already being handled." };
  }
  const undo: (() => Promise<unknown>)[] = [() => deps.kv.del(sigKey(sh))];
  const fail = async (status: number, error: string): Promise<RedeemResult> => {
    for (const f of undo.reverse()) await f().catch(() => {});
    return { ok: false, status, error };
  };

  try {
    // Daily limit.
    const day = utcToday(new Date(now));
    if ((await deps.kv.incrby(dayKey(day), 1)) > REDEEMS_PER_DAY) {
      await deps.kv.incrby(dayKey(day), -1);
      return await fail(429, `Only ${REDEEMS_PER_DAY} Portals can be redeemed a day on the testnet. Try again after midnight UTC.`);
    }
    undo.push(() => deps.kv.incrby(dayKey(day), -1));

    // The Portal must be free: not minted, and not being redeemed by someone else right now.
    if (await deps.portalOwner(portal)) return await fail(409, `Portal #${portal} is already taken. Pick another.`);
    if (!(await deps.kv.setnx(portalKey(portal), who))) return await fail(409, `Portal #${portal} is being redeemed by someone else. Pick another.`);
    undo.push(() => deps.kv.del(portalKey(portal)));

    if ((await deps.shardBalance(who)) < REDEEM_PRICE) return await fail(402, `You need ${REDEEM_PRICE} SHARD to redeem a Portal.`);

    const sent = await deps.send({ wallet: who, portal, note: `portalsweeper:redeem:${portal}:${sh}` });
    // Done. The Portal lock stays for good, the burned SHARD is counted, and the signature keeps its answer.
    await deps.kv.set(sigKey(sh), JSON.stringify({ state: "done", portal, ...sent }));
    await deps.kv.incrby(burnedKey, REDEEM_PRICE);
    const log: RedeemRecord[] = JSON.parse((await deps.kv.get(redeemLogKey)) ?? "[]");
    await deps.kv.set(redeemLogKey, JSON.stringify([...log, { portal, wallet: who, ...sent, at: now }].slice(-50)));
    return { ok: true, portal, ...sent };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Redeem failed.";
    // A timeout may still have landed: keep the locks so nothing is sent twice, and say so.
    if (/timed out/i.test(error)) return { ok: false, status: 504, error: "The chain did not answer in time. Check your wallet before trying again." };
    return await fail(502, error.startsWith("assets.") || error.startsWith("nfts.") ? `The chain refused it (${error}).` : "Could not send it to the chain. Nothing was taken.");
  }
}
