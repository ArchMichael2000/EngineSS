/**
 * Output gain staging for the physical core.
 *
 * The simulator's output is calibrated in sound pressure: each listener perspective maps a fixed
 * dB SPL to full scale, so a straight-piped 7 L V10 at full throttle (≈ 120 dB at 3 m) sits far
 * above full scale while a diesel idling is 50 dB lower. Clipping each sample (what the core used to
 * do above 0.9) turns a loud engine into a buzzing drone. This stage does what a recordist does
 * instead, in two parts:
 *
 * 1. Automatic gain (optional, on by default): a slow peak-envelope follower sets the gain so peaks
 *    sit near `targetDb`. It cuts by up to `maxCutDb` with a `attackS` attack and recovers over
 *    `releaseS`, so the idle → full-throttle swing of a single run is kept, and it boosts quiet
 *    engines by at most `maxBoostDb`. Off, the output stays at its physical level.
 * 2. A look-ahead peak limiter (`lookAheadS`, ceiling `ceilingDb`): the gain for each sample is the
 *    minimum over the look-ahead window of what every upcoming sample needs, smoothed, so it is
 *    already down when a peak leaves the delay line. No waveshaping, so no added harmonics.
 *
 * The output is delayed by the look-ahead (5 ms by default).
 */
export interface LevelerOptions {
  autoGain?: boolean;
  targetDb?: number;
  maxBoostDb?: number;
  maxCutDb?: number;
  attackS?: number;
  releaseS?: number;
  lookAheadS?: number;
  ceilingDb?: number;
  limiterReleaseS?: number;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

export class OutputLeveler {
  autoGain: boolean;
  private readonly target: number;
  private readonly maxBoost: number;
  private readonly minGain: number;
  private readonly attack: number;
  private readonly release: number;
  private readonly ceiling: number;
  private readonly limRelease: number;
  /** Look-ahead delay in samples. */
  readonly latency: number;
  private readonly delayL: Float32Array;
  private readonly delayR: Float32Array;
  /** Sliding-window minimum of the required gain: a monotonic deque of (sample time, gain). */
  private readonly dqTime: Float64Array;
  private readonly dqGain: Float32Array;
  private dqHead = 0;
  private dqLen = 0;
  /** Box average of the window minimum over `latency` samples. */
  private readonly boxRing: Float32Array;
  private boxSum: number;
  private time = 0;
  private envelope = 0;
  private agc = 1;
  private lim = 1;
  /** Total gain applied to the most recent output sample (for meters), linear. */
  lastGain = 1;

  constructor(private readonly sampleRate: number, options: LevelerOptions = {}) {
    this.autoGain = options.autoGain ?? true;
    this.target = dbToGain(options.targetDb ?? -6);
    this.maxBoost = dbToGain(options.maxBoostDb ?? 12);
    this.minGain = dbToGain(-(options.maxCutDb ?? 30));
    this.attack = 1 - Math.exp(-1 / ((options.attackS ?? 0.4) * sampleRate));
    this.release = 1 - Math.exp(-1 / ((options.releaseS ?? 4) * sampleRate));
    this.ceiling = dbToGain(options.ceilingDb ?? -2);
    this.latency = Math.max(1, Math.round((options.lookAheadS ?? 0.005) * sampleRate));
    this.limRelease = 1 - Math.exp(-1 / ((options.limiterReleaseS ?? 0.08) * sampleRate));
    this.delayL = new Float32Array(this.latency + 1);
    this.delayR = new Float32Array(this.latency + 1);
    this.dqTime = new Float64Array(this.latency + 2);
    this.dqGain = new Float32Array(this.latency + 2);
    this.boxRing = new Float32Array(this.latency).fill(1);
    this.boxSum = this.latency;
  }

  /** Level `count` samples of `left`/`right` in place. */
  process(left: Float32Array, right: Float32Array, count = left.length): void {
    const L = this.latency;
    const size = L + 1;
    const dqSize = this.dqTime.length;
    for (let i = 0; i < count; i++) {
      let l = left[i];
      let r = right[i];
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;
      const peak = Math.max(Math.abs(l), Math.abs(r));

      // 1. Slow automatic gain on the incoming signal's peak envelope.
      if (this.autoGain) {
        this.envelope += (peak - this.envelope) * (peak > this.envelope ? this.attack : this.release);
        const want = Math.min(this.maxBoost, Math.max(this.minGain, this.target / Math.max(1e-9, this.envelope)));
        this.agc += (want - this.agc) * (want < this.agc ? this.attack : this.release);
      } else this.agc = 1;
      l *= this.agc;
      r *= this.agc;

      // 2. Look-ahead limiter. The gain each sample needs, minimum over the samples still in the delay
      // line (this one and the L before it), then a box average over L samples: every value in the
      // average already saw a peak by the time that peak leaves the delay line, so the gain applied to
      // it is never above what it needs, and the gain moves as a ramp rather than a step.
      const t = this.time;
      const w = t % size;
      this.delayL[w] = l;
      this.delayR[w] = r;
      const req = Math.min(1, this.ceiling / Math.max(1e-12, peak * this.agc));
      while (this.dqLen > 0 && this.dqGain[(this.dqHead + this.dqLen - 1) % dqSize] >= req) this.dqLen--;
      const tail = (this.dqHead + this.dqLen) % dqSize;
      this.dqTime[tail] = t;
      this.dqGain[tail] = req;
      this.dqLen++;
      while (this.dqTime[this.dqHead] < t - L) {
        this.dqHead = (this.dqHead + 1) % dqSize;
        this.dqLen--;
      }
      const windowMin = this.dqGain[this.dqHead];
      const b = t % L;
      this.boxSum += windowMin - this.boxRing[b];
      this.boxRing[b] = windowMin;
      if (b === 0) {
        // Re-sum once per window so rounding never accumulates.
        let s = 0;
        for (let k = 0; k < L; k++) s += this.boxRing[k];
        this.boxSum = s;
      }
      const smooth = this.boxSum / L;
      // Down at once (the box average is already a ramp), back up over the release time.
      this.lim = smooth < this.lim ? smooth : this.lim + (smooth - this.lim) * this.limRelease;

      // Output the sample that entered L samples ago.
      const rIdx = (t + 1) % size;
      const g = Math.min(this.lim, 1);
      let outL = t >= L ? this.delayL[rIdx] * g : 0;
      let outR = t >= L ? this.delayR[rIdx] * g : 0;
      if (outL > 1) outL = 1;
      else if (outL < -1) outL = -1;
      if (outR > 1) outR = 1;
      else if (outR < -1) outR = -1;
      left[i] = outL;
      right[i] = outR;
      this.lastGain = this.agc * g;
      this.time = t + 1;
    }
  }
}
