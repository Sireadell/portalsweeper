// Placeholder while a Pot loads: a board-shaped card that gently pulses.
export default function BoardSkeleton({ text = "Picking a Pot…" }: { text?: string }) {
  return (
    <div className="mx-auto w-full max-w-[1060px]" role="status">
      <p className="mb-3 text-[14px] text-mute">{text}</p>
      <div className="aspect-square w-full max-w-[min(100%,calc(100svh-230px))] animate-pulse rounded-[20px] border border-edge bg-panel motion-reduce:animate-none lg:max-w-[min(660px,calc(100svh-230px))]" />
    </div>
  );
}
