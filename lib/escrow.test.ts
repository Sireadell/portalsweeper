// Runs the real compiled StakeEscrow code in a local EVM and checks the rules stakes depend on.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createVM } from "@ethereumjs/vm";
import { Common, Mainnet } from "@ethereumjs/common";
import { createBlock } from "@ethereumjs/block";
import { type Address, createAddressFromString, createAccount, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { encodeDeployData, encodeFunctionData, decodeFunctionResult, keccak256, toHex, type Abi, type Hex } from "viem";

const artifact = JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "StakeEscrow.json"), "utf8")) as { abi: Abi; bytecode: Hex };
const REF = "0x6cE5b32C1747442ff480DC1ce60a2b229CCa0F82" as Hex;
const A = "0x3E5E603dcEc9F5aa559cb7Be470ea0997EdCf62e" as Hex;
const B = "0x1111111111111111111111111111111111111111" as Hex;
const C = "0x2222222222222222222222222222222222222222" as Hex;
const STAKE = 10n ** 16n; // 0.01 tPOT
const NOW = 1_800_000_000n;
const DEADLINE = NOW + 3600n;
const idOf = (s: string) => keccak256(toHex(s));

let vm: Awaited<ReturnType<typeof createVM>>;
let escrow: Address;

const addr = (h: Hex) => createAddressFromString(h);
async function balance(h: Hex | Address): Promise<bigint> {
  const a = typeof h === "string" ? addr(h) : h;
  return (await vm.stateManager.getAccount(a))?.balance ?? 0n;
}
async function call(from: Hex, fn: string, args: unknown[], value = 0n, at = NOW) {
  const data = encodeFunctionData({ abi: artifact.abi, functionName: fn, args } as never);
  const block = createBlock({ header: { timestamp: at, number: 1n } }, { common: vm.common });
  const r = await vm.evm.runCall({ caller: addr(from), to: escrow, data: hexToBytes(data), value, gasLimit: 5_000_000n, block });
  return r.execResult;
}
async function read<T>(fn: string, args: unknown[]): Promise<T> {
  const r = await call(C, fn, args);
  return decodeFunctionResult({ abi: artifact.abi, functionName: fn, data: bytesToHex(r.returnValue) } as never) as T;
}
const reverted = (r: { exceptionError?: unknown }) => r.exceptionError !== undefined;
type M = readonly [Hex, Hex, bigint, bigint, number];

beforeAll(async () => {
  vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: "shanghai" }) });
  for (const w of [REF, A, B, C]) {
    const acc = createAccount({ balance: 10n ** 18n });
    await vm.stateManager.putAccount(addr(w), acc);
  }
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [REF] });
  const r = await vm.evm.runCall({ caller: addr(REF), data: hexToBytes(data), gasLimit: 5_000_000n });
  expect(r.execResult.exceptionError).toBeUndefined();
  escrow = r.createdAddress!;
});

describe("StakeEscrow", () => {
  it("holds both stakes in the contract and pays the pot to the winner the referee names", async () => {
    const id = idOf("m1");
    expect(reverted(await call(A, "create", [id, DEADLINE], STAKE))).toBe(false);
    expect(await balance(escrow)).toBe(STAKE);
    expect(reverted(await call(B, "join", [id], STAKE))).toBe(false);
    expect(await balance(escrow)).toBe(STAKE * 2n);
    const before = await balance(B);
    expect(reverted(await call(REF, "settle", [id, B]))).toBe(false);
    expect((await balance(B)) - before).toBe(STAKE * 2n);
    expect(await balance(escrow)).toBe(0n);
    expect((await read<M>("getMatch", [id]))[4]).toBe(3);
  });

  it("refuses a duplicate id, a zero stake and a deadline in the past", async () => {
    expect(reverted(await call(A, "create", [idOf("m1"), DEADLINE], STAKE))).toBe(true);
    expect(reverted(await call(A, "create", [idOf("m2"), DEADLINE], 0n))).toBe(true);
    expect(reverted(await call(A, "create", [idOf("m2"), NOW - 1n], STAKE))).toBe(true);
  });

  it("refuses a join with a different amount, or by the creator", async () => {
    const id = idOf("m3");
    await call(A, "create", [id, DEADLINE], STAKE);
    expect(reverted(await call(B, "join", [id], STAKE - 1n))).toBe(true);
    expect(reverted(await call(A, "join", [id], STAKE))).toBe(true);
    expect(reverted(await call(B, "join", [idOf("nope")], STAKE))).toBe(true);
  });

  it("only the referee can settle, only for a player, only when locked", async () => {
    const id = idOf("m3");
    expect(reverted(await call(REF, "settle", [id, A]))).toBe(true); // not locked yet
    await call(B, "join", [id], STAKE);
    expect(reverted(await call(A, "settle", [id, A]))).toBe(true); // not the referee
    expect(reverted(await call(REF, "settle", [id, C]))).toBe(true); // not a player
    expect(reverted(await call(REF, "settle", [id, A]))).toBe(false);
    expect(reverted(await call(REF, "settle", [id, A]))).toBe(true); // no second payout
  });

  it("the referee can refund both players (a draw)", async () => {
    const id = idOf("m4");
    await call(A, "create", [id, DEADLINE], STAKE);
    await call(B, "join", [id], STAKE);
    const a0 = await balance(A);
    const b0 = await balance(B);
    expect(reverted(await call(C, "refund", [id]))).toBe(true); // a stranger, too early
    expect(reverted(await call(REF, "refund", [id]))).toBe(false);
    expect((await balance(A)) - a0).toBe(STAKE);
    expect((await balance(B)) - b0).toBe(STAKE);
    expect(reverted(await call(REF, "refund", [id]))).toBe(true);
  });

  it("anyone can refund after the deadline when the referee never settles", async () => {
    const id = idOf("m5");
    await call(A, "create", [id, DEADLINE], STAKE);
    await call(B, "join", [id], STAKE);
    const a0 = await balance(A);
    const b0 = await balance(B);
    expect(reverted(await call(C, "refund", [id], 0n, DEADLINE))).toBe(true); // at the deadline, still early
    expect(reverted(await call(C, "refund", [id], 0n, DEADLINE + 1n))).toBe(false);
    expect((await balance(A)) - a0).toBe(STAKE);
    expect((await balance(B)) - b0).toBe(STAKE);
  });

  it("returns an unjoined stake after the deadline, and refuses a join after it", async () => {
    const id = idOf("m6");
    await call(A, "create", [id, DEADLINE], STAKE);
    expect(reverted(await call(B, "join", [id], STAKE, DEADLINE + 1n))).toBe(true);
    const a0 = await balance(A);
    expect(reverted(await call(C, "refund", [id], 0n, DEADLINE + 1n))).toBe(false);
    expect((await balance(A)) - a0).toBe(STAKE);
  });

  it("the contract never keeps a balance after every match is closed", async () => {
    expect(await balance(escrow)).toBe(0n);
  });
});
