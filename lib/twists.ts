// Twists are harder ways to play a board, chosen by the player before the first move.
// They only change what the screen shows and allows. The board, the mines, the winner check
// and the daily fingerprint are untouched, so every twist is fair: it is announced up front,
// it can be beaten by logic alone, and it never changes a number.
export type TwistId = "classic" | "harmattan" | "conductor" | "street";

export type Twist = {
  id: TwistId;
  name: string;
  short: string;
  why: string; // shown on screen so the player always knows the rule
  fadeNumbers: boolean;
  noFlags: boolean;
  noChord: boolean;
};

export const TWISTS: Twist[] = [
  { id: "classic", name: "Classic", short: "Normal rules", why: "Normal rules. Everything the Portal gives you is on.", fadeNumbers: false, noFlags: false, noChord: false },
  { id: "harmattan", name: "Harmattan", short: "Numbers fade", why: "Harmattan haze: each number fades 3 seconds after it opens. The number was true, so remember it.", fadeNumbers: true, noFlags: false, noChord: false },
  { id: "conductor", name: "Conductor", short: "No flags", why: "Conductor: no flags allowed. You must hold every mine in your head.", fadeNumbers: false, noFlags: true, noChord: false },
  { id: "street", name: "Street Rules", short: "No help", why: "Street Rules: numbers fade, no flags and no tapping a number to clear around it. Clear it and you earn the Hardcore badge.", fadeNumbers: true, noFlags: true, noChord: true },
];

export const twistById = (id: string | null | undefined): Twist => TWISTS.find((t) => t.id === id) ?? TWISTS[0];
export const isHardTwist = (id: TwistId) => id !== "classic";
export const isHardcore = (id: TwistId) => id === "street";
