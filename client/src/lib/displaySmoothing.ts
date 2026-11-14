/**
 * Smoothing of the engine speed shown on the gauge.
 *
 * The worklet reports speed about 23 times a second, and an idling engine wanders by tens of rpm,
 * so the raw figure flickers. A plain low-pass slow enough to hide that (0.25 s, what the display
 * used) trails a moving engine by its time constant times the rate of change: 250-540 rpm behind on
 * a 6 s dyno pull, 900-2000 rpm behind while the revs fall after it (measured on five presets), and
 * a short hold at the top is over before the figure gets there.
 *
 * The follower keeps that low-pass for a steady engine and adds back what it loses on a ramp. A
 * first-order low-pass trails a ramp by exactly (time constant x rate), so the correction is the
 * low-pass's own rate of change times its time constant. The correction comes in only as the rate
 * grows past what an idle does (250 rpm/s, fully in by 900), and the result is held between the
 * low-pass and the newest reading, so it cannot overshoot or show a peak the engine did not reach.
 */
export interface RpmFollower {
  /** Feed the newest reading and the time since the last call (s); returns the value to show. */
  step(reading: number, dt: number): number;
  /** True while the speed is changing fast enough for the correction to be at work. */
  readonly moving: boolean;
  reset(value: number): void;
}

/** Low-pass time constant, s. */
const SLOW_TAU = 0.25;
/** The rate estimate is smoothed over this, s. */
const RATE_TAU = 0.12;
/** The newest reading is smoothed over this before it bounds the result, s. */
const FAST_TAU = 0.04;
/** Rate of change (rpm/s) where the correction starts and where it is complete. */
const RATE_FROM = 250;
const RATE_FULL = 900;

export function createRpmFollower(): RpmFollower {
  let slow = -1;
  let fast = 0;
  let rate = 0;
  let moving = false;
  return {
    get moving() {
      return moving;
    },
    reset(value: number) {
      slow = value;
      fast = value;
      rate = 0;
      moving = false;
    },
    step(reading: number, dt: number) {
      if (slow < 0 || !(dt > 0)) {
        slow = reading;
        fast = reading;
        rate = 0;
        return reading;
      }
      const before = slow;
      slow += (reading - slow) * (1 - Math.exp(-dt / SLOW_TAU));
      fast += (reading - fast) * (1 - Math.exp(-dt / FAST_TAU));
      rate += ((slow - before) / dt - rate) * (1 - Math.exp(-dt / RATE_TAU));
      const share = Math.min(1, Math.max(0, (Math.abs(rate) - RATE_FROM) / (RATE_FULL - RATE_FROM)));
      moving = share > 0;
      // The smoothed rate trails too, by its own time constant: lead by both.
      let shown = slow + share * rate * (SLOW_TAU + RATE_TAU);
      const lo = Math.min(slow, fast);
      const hi = Math.max(slow, fast);
      if (shown < lo) shown = lo;
      else if (shown > hi) shown = hi;
      return shown;
    },
  };
}
