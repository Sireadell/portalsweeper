"use client";

// Small mute button. The choice is remembered by the parent through lib/sound.
export default function SoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={muted}
      aria-label={muted ? "Sound is off. Turn sound on" : "Sound is on. Mute sound"}
      onClick={onToggle}
      className="btn-ghost shrink-0 !min-h-[32px] !rounded-full !px-3 !py-1 text-[12px]"
    >
      {muted ? "🔇 Sound off" : "🔊 Sound on"}
    </button>
  );
}
