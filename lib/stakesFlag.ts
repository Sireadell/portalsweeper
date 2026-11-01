// Flag for the whole stakes feature. Off unless NEXT_PUBLIC_STAKES=1, so main works without the challenge flow.
// Kept apart from lib/stakes.ts so browser code can read it without pulling in the Redis client.
export const stakesEnabled = (): boolean => process.env.NEXT_PUBLIC_STAKES === "1";
