// Multisig helpers: the shared account that needs `threshold` of its signers to act (Multisig module).
import { createKeyMulti, encodeAddress, sortAddresses } from "@polkadot/util-crypto";

// The multisig account address is fixed by the sorted signer list and the threshold, in any input order.
export function multisigAddress(signers: string[], threshold: number): string {
  if (new Set(signers).size !== signers.length) throw new Error("Signers must all be different.");
  if (signers.length < 2) throw new Error("A multisig needs at least 2 signers.");
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > signers.length) throw new Error("Threshold must be from 2 up to the number of signers.");
  return encodeAddress(createKeyMulti(signers, threshold), 42);
}

// The other signers, as the chain wants them: everyone except the caller, sorted.
export function otherSignatories(signers: string[], caller: string): string[] {
  const others = sortAddresses(signers.filter((s) => s !== caller), 42);
  if (others.length !== signers.length - 1) throw new Error("The caller is not one of the signers.");
  return others;
}

// What setting up costs: a base amount plus an amount per signer (locked while an approval is waiting).
export function multisigDeposit(base: bigint, factor: bigint, signers: number): bigint {
  return base + factor * BigInt(signers);
}
