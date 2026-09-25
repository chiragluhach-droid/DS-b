const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** "15m", "12h", "7d" → milliseconds. Keeps cookie lifetimes in step with token lifetimes. */
export function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported duration "${value}" — use a number followed by s, m, h or d`);
  return Number(match[1]) * UNIT_MS[match[2]];
}
