// What gets written on a Portal on the chain itself, so anyone can read its name, picture link and traits
// straight from the NFT module without trusting our website.
export type PortalRecord = { id: number; name: string; image: string; traits: { trait_type: string; value: string }[] };

export type PortalAttribute = { key: string; value: string };

export function portalAttributes(p: PortalRecord, origin: string): PortalAttribute[] {
  const site = origin.replace(/\/+$/, "");
  return [
    { key: "name", value: p.name },
    { key: "image", value: `${site}${p.image}` },
    { key: "traits", value: p.traits.map((t) => `${t.trait_type}:${t.value}`).join(",") },
  ];
}

// Each attribute locks a deposit: a base amount plus an amount for every byte of key and value.
export function attributeDeposit(attrs: PortalAttribute[], base: bigint, perByte: bigint): bigint {
  const enc = new TextEncoder();
  return attrs.reduce((sum, a) => sum + base + perByte * BigInt(enc.encode(a.key).length + enc.encode(a.value).length), 0n);
}
