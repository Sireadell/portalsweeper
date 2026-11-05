// Real transactions on the Portaldot V3 testnet that anyone can look up. Each one was read back from the chain before it was listed.
export type ProofRow = { what: string; hash: string; block: number | null; kind: "tx" | "block" };

export const STAKE_CONTRACT = "0x9cebe7c313b0c86c55d956a3d07bd191fddabf9a";

export const PROOF: ProofRow[] = [
  { what: "Stake contract put on the chain", hash: "0x490eabae5f2070ace13cdb93a4b299adb9e075639f3646ab054623b4b7301da1", block: 326760, kind: "tx" },
  { what: "Stake match won: the contract paid the winner", hash: "0xdb68140095b7bae93e7894e6f00426a91fff0685a5129f41decb04b939a5eec1", block: 327257, kind: "tx" },
  { what: "Stake match drawn: the contract refunded both players", hash: "0x86c3947677ef349e1640bf3872c4384f0860f7434cdc702ce154b759cddceabb", block: 327267, kind: "tx" },
  { what: "First daily fingerprint written to the ledger contract", hash: "0x74f8c3deab3b6cc3464fc05476965ee40019e4b436ca8596e30520750cc207b1", block: 327450, kind: "tx" },
  { what: "A wallet on the EVM side calling a native chain feature in one step", hash: "0xcf5201a2de9f7d4efe0706b54fd05b1e6cd9211232419b94be648c6dec3d3279", block: 326771, kind: "tx" },
  { what: "Daily note written with the System Remark call", hash: "0x166121e04ad374e8b09135718fdb6a82f51e29f45ead048cd2518cc8d9120b3f", block: 326933, kind: "tx" },
  { what: "A replay file stored on the chain (Transaction Storage)", hash: "0x10e3e225cff5e397ce8674f9b74471d8b9bb619d143ad0cc24a392185ad1eaba", block: 326969, kind: "tx" },
  { what: "Identity name \"Portalsweeper\" set", hash: "0x30c1b98f977292c0dba74943bc30b9cd722136a600ea3955de16e54b607439f4", block: 332052, kind: "tx" },
  { what: "Portal collection 25 created", hash: "0x9d64e6e9249cf73c47af12e1177c1215a17340fd5e3abc5a40af2df920a452ba", block: 332042, kind: "block" },
  { what: "SHARD token (asset 5555) created", hash: "0xeeda778f25b9db90cffa730fbeb1892c3933f82c0c373dd49b2183a5ceff9e7c", block: 332048, kind: "block" },
];
