// Compiles contracts/StakeEscrow.sol and writes the ABI and bytecode to contracts/StakeEscrow.json.
// Run: npx tsx scripts/compile-escrow.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";

const file = path.join(process.cwd(), "contracts", "StakeEscrow.sol");
const input = {
  language: "Solidity",
  sources: { "StakeEscrow.sol": { content: readFileSync(file, "utf8") } },
  settings: {
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const c = out.contracts["StakeEscrow.sol"].StakeEscrow;
writeFileSync(
  path.join(process.cwd(), "contracts", "StakeEscrow.json"),
  JSON.stringify({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2) + "\n",
);
console.log(`Compiled StakeEscrow: ${c.evm.bytecode.object.length / 2} bytes of code.`);
