"use client";
import { stakesEnabled } from "@/lib/stakesFlag";

export const STAKE_CHOICES = ["0", "0.01", "0.05", "0.1"];
export const PORTAL_STAKE = "portal"; // not an amount: each player puts up one Portal

// Shows nothing unless NEXT_PUBLIC_STAKES=1, so the challenge screen can mount it without a check.
// StakeSelector: the creator picks what each player puts up. PotDisplay: what is at stake in a match.
export function StakeSelector({ value, onChange }: { value: string; onChange: (tpot: string) => void }) {
  if (!stakesEnabled()) return null;
  return (
    <fieldset className="stake-selector">
      <legend>Stake (testnet tPOT, no value)</legend>
      {STAKE_CHOICES.map((c) => (
        <label key={c} style={{ marginRight: 12 }}>
          <input type="radio" name="stake" checked={value === c} onChange={() => onChange(c)} /> {c === "0" ? "No stake" : `${c} tPOT`}
        </label>
      ))}
      <label style={{ marginRight: 12 }}>
        <input type="radio" name="stake" checked={value === PORTAL_STAKE} onChange={() => onChange(PORTAL_STAKE)} /> A Portal each
      </label>
    </fieldset>
  );
}

export function PotDisplay({ stakeTpot, potTpot, locked, asset = "tpot", portals = [] }: { stakeTpot: string; potTpot: string; locked: number; asset?: "tpot" | "portal"; portals?: number[] }) {
  if (!stakesEnabled()) return null;
  if (asset === "portal")
    return (
      <p className="pot-display">
        Portal stake: <strong>{locked} of 2 players</strong> have put up a Portal{portals.length ? ` (${portals.map((p) => `#${p}`).join(", ")})` : ""}. Winner takes both. Trusted custody: the game server holds staked Portals until the race ends. Testnet Portals.
      </p>
    );
  return (
    <p className="pot-display">
      Pot: <strong>{potTpot} tPOT</strong> ({locked} of 2 players have put up {stakeTpot} tPOT). Winner takes the pot. Testnet tPOT, no value.
    </p>
  );
}
