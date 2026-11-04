// Compiles contracts/DailyLedger.sol and writes the ABI and bytecode to contracts/DailyLedger.json.
// Run: npx tsx scripts/compile-ledger.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";

const file = path.join(process.cwd(), "contracts", "DailyLedger.sol");
const input = {
  language: "Solidity",
  sources: { "DailyLedger.sol": { content: readFileSync(file, "utf8") } },
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
const c = out.contracts["DailyLedger.sol"].DailyLedger;
writeFileSync(
  path.join(process.cwd(), "contracts", "DailyLedger.json"),
  JSON.stringify({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2) + "\n",
);
console.log(`Compiled DailyLedger: ${c.evm.bytecode.object.length / 2} bytes of code.`);
