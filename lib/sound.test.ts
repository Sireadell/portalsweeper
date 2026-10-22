import { describe, expect, it } from "vitest";
import { notesFor, play, readMuted, soundForMove, totalDuration, unlockAudio, writeMuted } from "./sound";

function fakeStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("sound notes", () => {
  it("win is short and rises", () => {
    const n = notesFor("win");
    expect(totalDuration(n)).toBeLessThan(1.2);
    const lead = n.filter((x) => x.type === "triangle").map((x) => x.freq);
    expect(lead).toEqual([...lead].sort((a, b) => a - b));
  });
  it("win and loss are both loud", () => {
    expect(Math.max(...notesFor("win").map((x) => x.gain))).toBeGreaterThanOrEqual(0.4);
    expect(Math.max(...notesFor("lose").map((x) => x.gain))).toBeGreaterThanOrEqual(0.8);
  });
  it("loss is a boom: a static burst that closes down plus a thump that drops", () => {
    const lose = notesFor("lose");
    const burst = lose.find((x) => x.noise);
    expect(burst).toBeTruthy();
    expect(burst!.to!).toBeLessThan(burst!.freq);
    const thump = lose.find((x) => !x.noise && x.to && x.freq < 200);
    expect(thump).toBeTruthy();
    expect(totalDuration(lose)).toBeLessThan(1.2);
  });
});

describe("move sounds", () => {
  const base = { revealed: 0, flagged: 0, shielded: 0, over: false };
  it("every small sound is short and quiet", () => {
    for (const k of ["tap", "open", "flag", "unflag", "shield"] as const) {
      const n = notesFor(k);
      expect(totalDuration(n)).toBeLessThan(0.5);
      expect(Math.max(...n.map((x) => x.gain))).toBeLessThanOrEqual(0.1);
    }
  });
  it("picks tap, open, flag, unflag and shield from the counts", () => {
    expect(soundForMove(base, { ...base, revealed: 1 })).toBe("tap");
    expect(soundForMove(base, { ...base, revealed: 9 })).toBe("open");
    expect(soundForMove(base, { ...base, flagged: 1 })).toBe("flag");
    expect(soundForMove({ ...base, flagged: 1 }, base)).toBe("unflag");
    expect(soundForMove(base, { ...base, shielded: 1 })).toBe("shield");
    expect(soundForMove(base, base)).toBeNull();
  });
  it("stays quiet when the game ends or the board resets", () => {
    expect(soundForMove(base, { ...base, revealed: 3, over: true })).toBeNull();
    expect(soundForMove({ ...base, revealed: 5 }, base)).toBeNull();
  });
});

describe("mute memory", () => {
  it("defaults to sound on and round-trips", () => {
    const s = fakeStore();
    expect(readMuted(s)).toBe(false);
    writeMuted(true, s);
    expect(readMuted(s)).toBe(true);
    writeMuted(false, s);
    expect(readMuted(s)).toBe(false);
  });
  it("survives blocked storage", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readMuted(bad)).toBe(false);
    expect(() => writeMuted(true, bad)).not.toThrow();
    expect(readMuted(null)).toBe(false);
  });
});

describe("autoplay rule", () => {
  it("stays silent and does not throw before any tap", () => {
    expect(() => play("win", false)).not.toThrow();
    expect(() => unlockAudio()).not.toThrow();
  });
});
