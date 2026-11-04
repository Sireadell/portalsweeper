// The SHARD token: made with Portaldot's built-in Assets module (no contract), and readable from
// Solidity and MetaMask as a normal ERC-20 token at a fixed address worked out from its asset id.
export const SHARD_NAME = "Portalsweeper Shard";
export const SHARD_SYMBOL = "SHARD";
export const SHARD_DECIMALS = 0; // one shard is one whole clear
export const SHARD_MIN_BALANCE = 1;
// The asset id is a free number picked when the token is made. Override with env SHARD_ASSET_ID.
export const DEFAULT_SHARD_ASSET_ID = 5555;

// The ERC-20 address of a native asset: the asset id as 4 bytes, twelve zero bytes, then 00010000.
export function assetErc20Address(assetId: number): `0x${string}` {
  if (!Number.isInteger(assetId) || assetId < 0 || assetId > 0xffffffff) throw new Error("Asset id must be a whole number that fits in 4 bytes.");
  return `0x${assetId.toString(16).padStart(8, "0")}${"0".repeat(24)}00010000`;
}

export function shardAssetId(): number {
  const raw = process.env.SHARD_ASSET_ID?.trim();
  if (!raw) return DEFAULT_SHARD_ASSET_ID;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error("SHARD_ASSET_ID must be a whole number.");
  return n;
}
