// SHARED CONTRACT. Every session codes against these types. Change only with the lead session's OK.

// Portaldot V3 testnet. The EVM side (pallet-revive) carries the daily fingerprint posts and the
// player's wallet; the native side holds the Pot NFT collection (pallet-nfts).
export const PORTALDOT_CHAIN_ID = 420420777;
export const PORTALDOT_RPC = "https://test-evm-rpc-v3.portaldot.dev";
export const PORTALDOT_WS = "wss://test-node-v3.portaldot.dev";
export const PORTALDOT_CONSOLE = "https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev";
// Link to a block in the Portaldot Node Console (there is no EVM explorer for V3 yet).
export const blockLink = (block: number | string) => `${PORTALDOT_CONSOLE}#/explorer/query/${block}`;
// The native NFT collection that holds the Pots. Set POT_COLLECTION_ID once the collection is created.
export const POT_COLLECTION_ID = Number(process.env.NEXT_PUBLIC_POT_COLLECTION_ID ?? process.env.POT_COLLECTION_ID ?? -1);
export const POT_SUPPLY = 500;

export type Trait = { trait_type: string; value: string };

// One Pot as stored in data/pots.json (drawn by scripts/gen-pots.mjs)
export type PotMeta = {
  id: number;            // token id
  name: string;
  image: string;         // https gateway URL of the art
  traits: Trait[];       // the 12 traits
};

export type Cell = { mine: boolean; adj: number };

export type RuleId = "tier-size" | "glaze-peek" | "charm-flag" | "lid-shield";

// A trait rule that fired for this Pot (shown on screen with `why`)
export type FiredRule = { id: RuleId; trait: string; value: string; why: string };

export type Board = {
  tokenId: number;
  date: string;          // UTC date YYYY-MM-DD
  cols: number;
  rows: number;
  mines: number;
  cells: Cell[];         // row-major, length cols*rows
  rules: FiredRule[];
  freePeek?: number;     // cell index revealed safe by Glaze rule
  freeFlag?: number;     // cell index of a mine pre-flagged by Charm rule
  shields: number;       // lives from Lid rule (0 or 1)
  commit: string;        // 0x keccak of the salt used (the public fingerprint)
};

// engine API (lib/engine.ts, owned by the ENGINE session):
//   generateBoard(meta: PotMeta, date: string, salt: string): Board
//   saltCommit(salt: string): string
// chain API (lib/chain.ts, owned by the CHAIN session):
//   getOwnedPots(address: string): Promise<number[]>
//   getPotMeta(id: number): Promise<PotMeta>      // reads data/pots.json first
