// The free message a player signs to redeem. Kept apart from lib/redeem.ts so the browser can import it without the server code.
export const REDEEM_PRICE = 100;
export const redeemMessage = (portal: number, issuedAt: number) => `Portalsweeper: redeem ${REDEEM_PRICE} SHARD for Portal #${portal}. Signed at ${issuedAt}. This costs no gas.`;
