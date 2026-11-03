// The computer opponent for Practice. It does not play your board: it clears an imaginary one at a set pace,
// the same speed every time at each level, so a race is fair and nothing about your board is guessed.
export type CpuLevel = "off" | "easy" | "medium" | "hard";
export const CPU_LEVELS: { id: CpuLevel; name: string; secondsPerSafeTile: number }[] = [
  { id: "off", name: "Solo", secondsPerSafeTile: 0 },
  { id: "easy", name: "CPU easy", secondsPerSafeTile: 1.4 },
  { id: "medium", name: "CPU medium", secondsPerSafeTile: 0.9 },
  { id: "hard", name: "CPU hard", secondsPerSafeTile: 0.55 },
];

// Seconds the computer needs to clear a board with this many safe tiles.
export function cpuTotalSeconds(level: CpuLevel, safeTiles: number): number {
  const l = CPU_LEVELS.find((x) => x.id === level);
  return !l || level === "off" ? 0 : Math.round(l.secondsPerSafeTile * safeTiles);
}

// Where the computer is after this many seconds, 0 to 100. It slows a little near the end, like a person.
export function cpuPercent(level: CpuLevel, safeTiles: number, elapsed: number): number {
  const total = cpuTotalSeconds(level, safeTiles);
  if (!total) return 0;
  const t = Math.min(1, Math.max(0, elapsed / total));
  return Math.min(100, Math.round(100 * (t < 0.8 ? t * 1.1 : 0.88 + (t - 0.8) * 0.6)));
}

// After the game: who finished first. Playing to a loss (a mine) is a loss to the CPU.
export function cpuVerdict(level: CpuLevel, safeTiles: number, won: boolean, seconds: number): { youWon: boolean; margin: number } | null {
  const total = cpuTotalSeconds(level, safeTiles);
  if (!total) return null;
  if (!won) return { youWon: false, margin: 0 };
  return { youWon: seconds < total, margin: Math.abs(Math.round(total - seconds)) };
}
