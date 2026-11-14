/**
 * How fast the engine cross-section turns on screen, in crank revolutions per second.
 *
 * The drawing cannot show the real speed: a screen refreshes 60 times a second, and an engine at
 * 6000 rpm turns 100 times a second, so drawn at true speed it would only strobe. The view shows a
 * slowed speed that still tells idle from full speed:
 *
 *  - at idle and below, the pace it has always had: 0.35 rev/s plus 0.85 rev/s x (rpm / redline),
 *    about 0.45 rev/s for a car engine idling;
 *  - above idle it rises to TOP_PACE (5 rev/s) at the redline, along (share of the way from idle to
 *    redline)^1.3, so the first few hundred rpm off idle stay readable and the upper half of the
 *    range is plainly fast.
 *
 * 5 rev/s is 30 degrees of crank per frame at 60 frames a second, about the fastest motion that
 * still reads as rotation in the right direction. The view prints the shown pace and how many times
 * slower than the engine it is, so it is never taken for the real speed.
 */
export const TOP_PACE = 5;

export function viewPace(rpm: number, idleRpm: number, redlineRpm: number): number {
  const red = Math.max(1000, redlineRpm);
  const idle = Math.min(Math.max(0, idleRpm), red * 0.6);
  const legacy = (r: number) => 0.35 + 0.85 * Math.min(1, Math.max(0, r) / red);
  if (rpm <= idle) return legacy(rpm);
  const atIdle = legacy(idle);
  const share = Math.min(1, (rpm - idle) / (red - idle));
  return atIdle + (TOP_PACE - atIdle) * Math.pow(share, 1.3);
}
