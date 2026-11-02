"use client";
import { stakesEnabled } from "@/lib/stakesFlag";

export const STAKE_CHOICES = ["0", "0.01", "0.05", "0.1"];

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
    </fieldset>
  );
}

export function PotDisplay({ stakeTpot, potTpot, locked }: { stakeTpot: string; potTpot: string; locked: number }) {
  if (!stakesEnabled()) return null;
  return (
    <p className="pot-display">
      Pot: <strong>{potTpot} tPOT</strong> ({locked} of 2 players have put up {stakeTpot} tPOT). Winner takes the pot. Testnet tPOT, no value.
    </p>
  );
}
