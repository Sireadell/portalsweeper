// Tiny sound effects made with the Web Audio API, so there are no audio files to load.
// Browsers keep sound off until the person has tapped something, so the audio context is
// only created and resumed from a tap (see unlockAudio). Mute is remembered in localStorage.

// freq is the pitch in Hz. `to` slides the pitch to that value by the end of the note.
// `noise` plays a burst of static instead of a tone, with freq as the filter's opening pitch
// (it closes down to `to`), which is what makes an explosion.
export type Note = { freq: number; start: number; dur: number; gain: number; type: OscillatorType; to?: number; noise?: boolean };
export type SoundKind = "win" | "lose" | "tap" | "open" | "flag" | "unflag" | "shield";

const MUTE_KEY = "potsweeper:muted";

// Win: a quick rising major arpeggio ending on a held top note. Lose: two soft falling notes.
const WIN_FREQS = [523.25, 659.25, 783.99, 1046.5];

export function notesFor(kind: SoundKind): Note[] {
  if (kind === "win") {
    return [
      ...WIN_FREQS.map((freq, i): Note => ({ freq, start: i * 0.11, dur: i === 3 ? 0.8 : 0.22, gain: 0.5, type: "triangle" })),
      // The same run an octave lower, so it sounds full rather than thin.
      ...WIN_FREQS.map((freq, i): Note => ({ freq: freq / 2, start: i * 0.11, dur: i === 3 ? 0.8 : 0.22, gain: 0.35, type: "sine" })),
      { freq: 1568, start: 0.33, dur: 0.7, gain: 0.2, type: "sine" },
      { freq: 2093, start: 0.36, dur: 0.6, gain: 0.12, type: "sine" },
    ];
  }
  if (kind === "tap") {
    // One short, soft click for a single square opening.
    return [{ freq: 660, start: 0, dur: 0.06, gain: 0.07, type: "triangle" }];
  }
  if (kind === "open") {
    // A quick rising run for a patch of squares opening at once.
    return [
      { freq: 440, start: 0, dur: 0.07, gain: 0.07, type: "triangle" },
      { freq: 587.33, start: 0.05, dur: 0.07, gain: 0.07, type: "triangle" },
      { freq: 783.99, start: 0.1, dur: 0.12, gain: 0.07, type: "triangle" },
    ];
  }
  if (kind === "flag") {
    return [
      { freq: 392, start: 0, dur: 0.05, gain: 0.07, type: "square" },
      { freq: 523.25, start: 0.05, dur: 0.07, gain: 0.07, type: "square" },
    ];
  }
  if (kind === "unflag") {
    return [{ freq: 330, start: 0, dur: 0.07, gain: 0.06, type: "square" }];
  }
  if (kind === "shield") {
    // A bright ping, then a low note: the hit was absorbed.
    return [
      { freq: 880, start: 0, dur: 0.12, gain: 0.1, type: "sine" },
      { freq: 196, start: 0.05, dur: 0.3, gain: 0.1, type: "sine" },
    ];
  }
  // Lose: a boom. Static that closes down, a low thump that drops, then two sad falling notes.
  return [
    { freq: 2600, to: 90, start: 0, dur: 0.75, gain: 0.9, type: "sine", noise: true },
    { freq: 150, to: 38, start: 0, dur: 0.6, gain: 0.95, type: "sine" },
    { freq: 80, to: 30, start: 0.02, dur: 0.7, gain: 0.5, type: "triangle" },
    { freq: 293.66, start: 0.35, dur: 0.25, gain: 0.3, type: "triangle" },
    { freq: 220, start: 0.55, dur: 0.5, gain: 0.3, type: "triangle" },
  ];
}

export type MoveSummary = { revealed: number; flagged: number; shielded: number; over: boolean };

// Which small sound a move earns, from the counts before and after it. Wins and losses have
// their own sounds, so a move that ends the game stays quiet here. A drop in revealed squares
// means the board was reset, which also stays quiet.
export function soundForMove(prev: MoveSummary, next: MoveSummary): SoundKind | null {
  if (next.over || prev.over) return null;
  if (next.revealed < prev.revealed) return null;
  if (next.shielded > prev.shielded) return "shield";
  const opened = next.revealed - prev.revealed;
  if (opened >= 4) return "open";
  if (opened >= 1) return "tap";
  if (next.flagged > prev.flagged) return "flag";
  if (next.flagged < prev.flagged) return "unflag";
  return null;
}

export function totalDuration(notes: Note[]): number {
  return notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function store(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readMuted(s: StorageLike | null = store()): boolean {
  try {
    return s?.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean, s: StorageLike | null = store()): void {
  try {
    s?.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch { /* storage blocked, the choice just lasts for this visit */ }
}

let ctx: AudioContext | null = null;
let master: AudioNode | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    // A limiter on the way out lets the big sounds be loud without crackling.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    master = limiter;
    return ctx;
  } catch {
    return null;
  }
}

// Call from a tap or key press. Until this has run once, play() stays silent.
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  unlocked = true;
  if (c.state === "suspended") void c.resume().catch(() => {});
}

export function play(kind: SoundKind, muted: boolean): void {
  if (muted || !unlocked || !ctx) return;
  try {
    const t0 = ctx.currentTime + 0.02;
    const out = master ?? ctx.destination;
    for (const n of notesFor(kind)) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + n.start);
      g.gain.exponentialRampToValueAtTime(n.gain, t0 + n.start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.start + n.dur);
      if (n.noise) {
        const len = Math.ceil(ctx.sampleRate * (n.dur + 0.05));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(n.freq, t0 + n.start);
        if (n.to) filter.frequency.exponentialRampToValueAtTime(n.to, t0 + n.start + n.dur);
        src.connect(filter).connect(g).connect(out);
        src.start(t0 + n.start);
        src.stop(t0 + n.start + n.dur + 0.05);
      } else {
        const osc = ctx.createOscillator();
        osc.type = n.type;
        osc.frequency.setValueAtTime(n.freq, t0 + n.start);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.start + n.dur);
        osc.connect(g).connect(out);
        osc.start(t0 + n.start);
        osc.stop(t0 + n.start + n.dur + 0.05);
      }
    }
  } catch { /* sound is a bonus, never break the game */ }
}
