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
  { what: "Portal #102 minted to a player with its name, image and traits", hash: "0xca1af6cb944eb46beee57c131ae06667b02100b9ab2ada5d095601b0d9374ad9", block: 332827, kind: "tx" },
  { what: "SHARD trading pool opened (5 tPOT and 90 SHARD)", hash: "0xabe2dbb43d64bf8391344eb2215f589da0db12f3d36e84fa50950ff296dab405", block: 332885, kind: "tx" },
  { what: "One action: mint Portal #103, write 3 traits, issue SHARD, leave a note (rehearsal to a team wallet)", hash: "0xebf6729cfea048e05fd6f8a467c44a309d72aa84bd052efdf9237a93ebbef94f", block: 332941, kind: "tx" },
  { what: "Portal swap offered from a normal 0x wallet", hash: "0x04f14ae2acc201d0ed05bcb981703036c9953b449f5186d538f058b9e14a9b21", block: 332984, kind: "tx" },
  { what: "Portal swap accepted by the other wallet", hash: "0x6a7642dbf3de4ed4d859b33478d59206e8f2a3ce8535c72264056d11d3524b8f", block: 332995, kind: "tx" },
  { what: "Portal #104 minted from a pre-signed order", hash: "0x1506a9b43d494a9391c501a4384016781a917ed37301a7151cc0ec3919adaf84", block: 333041, kind: "tx" },
  { what: "Player A sets a chain name from a normal 0x wallet", hash: "0xe702eb82778ad5177266ea0a2c091b800b33dbb88f3a7f9705aebc78b9fda116", block: 334681, kind: "tx" },
  { what: "Player B sets a chain name from a normal 0x wallet", hash: "0x60da17dfa0d20f2c42118c4eafdf77d25e727e93cfa8d78eae0f877388765b48", block: 334682, kind: "tx" },
  { what: "Portal stake: player locks a Portal in escrow", hash: "0xbaf0b075ec57e754893538d7357714e19f742f985dafe6c3d4843890c70b36d3", block: 333468, kind: "tx" },
  { what: "Portal stake: second player locks a Portal", hash: "0x776b2b31d3b4c3545411b82e49e284dc852a4b7b6c5db14419166046916e39b2", block: 333470, kind: "tx" },
  { what: "Portal stake: winner receives both Portals in one action", hash: "0xed5b9b7700fa50a6b803b00286888e39578cec7272b84b01fa2df378b802c34b", block: 333472, kind: "tx" },
  { what: "Daily SHARD prizes for 1st, 2nd and 3rd paid in one action (test day)", hash: "0x6fdfdfa7df592f9df1827097f7427cfb73e391e4aee50669d29e2a05b89ce6f8", block: 333404, kind: "tx" },
  { what: "Redeem: 100 SHARD burned and Portal #477 minted in one action", hash: "0xf3460a822018aa88a1d5a746b4e5e81a3b6f777c0207d26766d966198b4ecbc7", block: 333419, kind: "tx" },
  { what: "Backing pool: winners' backers paid in one action (test coins)", hash: "0x66e0f1b146f6c280a470c64166887a4dbdcec95870e97883f58a5792b57ab4aa", block: 333620, kind: "tx" },
  { what: "Backing pool with a 5% treasury cut: winner paid, cut sent to the treasury and a note listing pot, cut and share, all in one action (test coins)", hash: "0x40a4634314c406dea129ca88dc4938c1cfb7ae3c7157a6e961a146f57f297422", block: 335236, kind: "tx" },
  { what: "Backing pool: cancelled event refunded in one action (test coins)", hash: "0x333d40acc33527417e70a58b43d8c709d08f0301ee03a504c0d98fdf0d95914f", block: 333623, kind: "tx" },
  { what: "Chain fee paid in SHARD: a native account sent a note, SHARD went down by 1 and its tPOT did not move", hash: "0x73ef1b4abcf921afbeade9745784f2be0bccea71dfe1e1d09b46d9154c3ead65", block: 338726, kind: "tx" },
  { what: "Portal sale: Player B bought Portal #398 from the treasury through the chain's built-in shop for 6.52 tPOT, new owner read back from the chain", hash: "0xd2878f0c4dbf36b8203bf1a88b8986cbf96a3150b723ddaa0dbb895ef02f7c7f", block: 339731, kind: "tx" },
];
