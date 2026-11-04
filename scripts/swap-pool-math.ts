// Pool maths for the SHARD / tPOT swap pool (Assets Conversion module, a constant product pool like Uniswap v2).
// Pure functions, so they can be tested without a chain.

// The pallet's swap fee is lpFee out of a denominator (3 of 1000, or 3000 of 1,000,000, both mean 0.3%).
export function quoteOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, lpFee = 3n, denom = 1000n): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inWithFee = amountIn * (denom - lpFee);
  return (inWithFee * reserveOut) / (reserveIn * denom + inWithFee);
}

// The chain reports lpFee as a plain number. Values of 1000 or more are out of a million, smaller ones out of a thousand.
export const feeDenominator = (lpFee: bigint): bigint => (lpFee >= 1000n ? 1_000_000n : 1000n);

// Smallest output we accept: the quote minus a slippage allowance in percent (whole number).
export function minOut(quote: bigint, slippagePercent: bigint): bigint {
  if (slippagePercent < 0n || slippagePercent > 100n) throw new Error("Slippage must be 0 to 100.");
  return (quote * (100n - slippagePercent)) / 100n;
}

// tPOT has 14 decimals on the native side.
export function parseTpot14(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,14}))?$/.exec(s.trim());
  if (!m) throw new Error("Amount must be a plain number like 5 or 0.25.");
  return BigInt(m[1]) * 10n ** 14n + BigInt((m[2] ?? "").padEnd(14, "0"));
}
