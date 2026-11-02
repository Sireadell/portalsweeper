// Asks the connected wallet to sign a short text (free, no transaction).
type Eth = { request(a: { method: string; params: unknown[] }): Promise<string> };

function toHex(s: string): string {
  return "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function signText(text: string, address: string): Promise<string> {
  const eth = window.ethereum as unknown as Eth;
  return eth.request({ method: "personal_sign", params: [toHex(text), address] });
}
