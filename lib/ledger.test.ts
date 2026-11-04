// Runs the real compiled DailyLedger code in a local EVM and checks the rules the game depends on.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createVM } from "@ethereumjs/vm";
import { Common, Mainnet } from "@ethereumjs/common";
import { type Address, createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { encodeDeployData, encodeFunctionData, decodeFunctionResult, type Abi, type Hex } from "viem";
import { commitOf } from "./salt";

const artifact = JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "DailyLedger.json"), "utf8")) as { abi: Abi; bytecode: Hex };
const WRITER = "0x6cE5b32C1747442ff480DC1ce60a2b229CCa0F82" as Hex;
const OTHER = "0x3E5E603dcEc9F5aa559cb7Be470ea0997EdCf62e" as Hex;
const SALT = "0x" + "ab".repeat(32); // same shape as the game's daily salt: text "0x" plus 64 hex characters
const DAY = 20261105;
const MOVES = ("0x" + "11".repeat(32)) as Hex;

let vm: Awaited<ReturnType<typeof createVM>>;
let ledger: Address;

async function send(from: Hex, fn: string, args: unknown[]) {
  const data = encodeFunctionData({ abi: artifact.abi, functionName: fn, args } as never);
  const r = await vm.evm.runCall({ caller: createAddressFromString(from), to: ledger, data: hexToBytes(data), gasLimit: 5_000_000n });
  return r.execResult;
}
async function read<T>(fn: string, args: unknown[]): Promise<T> {
  const data = encodeFunctionData({ abi: artifact.abi, functionName: fn, args } as never);
  const r = await vm.evm.runCall({ caller: createAddressFromString(OTHER), to: ledger, data: hexToBytes(data), gasLimit: 5_000_000n });
  return decodeFunctionResult({ abi: artifact.abi, functionName: fn, data: bytesToHex(r.execResult.returnValue) } as never) as T;
}
const reverted = (r: { exceptionError?: unknown }) => r.exceptionError !== undefined;

beforeAll(async () => {
  vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: "shanghai" }) });
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [WRITER] });
  const r = await vm.evm.runCall({ caller: createAddressFromString(WRITER), data: hexToBytes(data), gasLimit: 5_000_000n });
  expect(r.execResult.exceptionError).toBeUndefined();
  ledger = r.createdAddress!;
});

describe("DailyLedger", () => {
  it("only the writer can commit", async () => {
    expect(reverted(await send(OTHER, "commit", [DAY, commitOf(SALT)]))).toBe(true);
  });

  it("a committed day cannot be committed twice", async () => {
    expect(reverted(await send(WRITER, "commit", [DAY, commitOf(SALT)]))).toBe(false);
    expect(reverted(await send(WRITER, "commit", [DAY, commitOf("0x" + "cd".repeat(32))]))).toBe(true);
  });

  it("stores the fingerprint the game computes with keccak256 of the salt text", async () => {
    const d = await read<readonly [Hex, bigint, Hex, bigint, boolean]>("getDay", [DAY]);
    expect(d[0]).toBe(commitOf(SALT));
    expect(d[4]).toBe(false);
  });

  it("matches() is true only for the right salt", async () => {
    expect(await read<boolean>("matches", [DAY, SALT])).toBe(true);
    expect(await read<boolean>("matches", [DAY, "0x" + "00".repeat(32)])).toBe(false);
  });

  it("refuses a winner before the reveal", async () => {
    expect(reverted(await send(WRITER, "recordWinner", [DAY, 7, OTHER, MOVES]))).toBe(true);
  });

  it("records the chain random number once, writer only", async () => {
    const rnd = ("0x" + "22".repeat(32)) as Hex;
    expect(reverted(await send(OTHER, "setRandomness", [DAY, rnd, 12345n]))).toBe(true);
    expect(reverted(await send(WRITER, "setRandomness", [DAY, rnd, 12345n]))).toBe(false);
    expect(reverted(await send(WRITER, "setRandomness", [DAY, rnd, 12346n]))).toBe(true);
    const d = await read<readonly [Hex, bigint, Hex, bigint, boolean]>("getDay", [DAY]);
    expect(d[2]).toBe(rnd);
    expect(d[3]).toBe(12345n);
  });

  it("refuses a wrong salt and accepts the right one from anyone", async () => {
    expect(reverted(await send(OTHER, "reveal", [DAY, "0x" + "00".repeat(32)]))).toBe(true);
    expect(reverted(await send(OTHER, "reveal", [DAY, SALT]))).toBe(false);
    expect((await read<readonly [Hex, bigint, Hex, bigint, boolean]>("getDay", [DAY]))[4]).toBe(true);
  });

  it("cannot reveal twice or set randomness after the reveal", async () => {
    expect(reverted(await send(OTHER, "reveal", [DAY, SALT]))).toBe(true);
    expect(reverted(await send(WRITER, "setRandomness", [DAY, "0x" + "33".repeat(32), 1n]))).toBe(true);
  });

  it("records a winner after the reveal, writer only", async () => {
    expect(reverted(await send(OTHER, "recordWinner", [DAY, 7, OTHER, MOVES]))).toBe(true);
    const ok = await send(WRITER, "recordWinner", [DAY, 7, OTHER, MOVES]);
    expect(reverted(ok)).toBe(false);
    expect(ok.logs?.length).toBe(1);
  });

  it("refuses to reveal a day that was never committed", async () => {
    expect(reverted(await send(OTHER, "reveal", [20261106, SALT]))).toBe(true);
  });
});
