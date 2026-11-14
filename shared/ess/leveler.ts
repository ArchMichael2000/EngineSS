/**
 * Output gain staging for the physical core.
 *
 * The simulator's output is calibrated in sound pressure: each listener perspective maps a fixed
 * dB SPL to full scale, so a straight-piped 7 L V10 at full throttle (≈ 120 dB at 3 m) sits far
 * above full scale while a diesel idling is 50 dB lower. Clipping each sample (what the core used to
 * do above 0.9) turns a loud engine into a buzzing drone. This stage does what a recordist does
 * instead, in two parts:
 *
 * 1. Automatic gain (optional, on by default): a loudness rider. It measures the K-weighted
 *    loudness of the signal (ITU-R BS.1770 weighting, 0.4 s) and sets the gain so the engine sits
 *    at a target that follows how hard it is being worked (`effort`, from the simulator: pedal and
 *    speed): `targetLufs` at full effort, `dynamicsDb` lower at idle. Every engine therefore plays
 *    equally loud at full load and keeps the same idle-to-full swing, whatever its physical level;
 *    the gain can rise `maxBoostDb` and fall `maxCutDb`. Off, the output stays at its physical
 *    level.
 *    A peak guard keeps recurring peaks near `targetDb`. It reads the true peak of each 0.1 s and
 *    takes the third largest of the last eight, so a train of sparse pulses (an engine on its rev
 *    limiter, a two-stroke popping at idle; anything from four pulses a second) is taken at its
 *    real peaks and not ridden up into the limiter, while a single afterfire bang 30 dB over the
 *    engine is left to the limiter instead of ducking the run. A level that has lasted 80 ms (the
 *    lowest of the last four 20 ms peaks) counts at once. And while `effort` is rising and for
 *    0.5 s after, which is the driver opening the throttle and not a bang, every peak counts at
 *    once, so a rev from idle is taken by the rider within 50 ms and not held down by the limiter. One instant counts
 *    for at most 9 dB over the running loudness, again for the bang. The guard may pull the gain
 *    at most `maxPeakCutDb` under the loudness gain.
 *    (History. The first rider followed a peak envelope that rose over 0.4 s: on sparse pulses it
 *    read 8 dB under the real peaks and the limiter took the boost back pulse by pulse, audible
 *    distortion. The second followed peaks alone with a 12 dB boost limit and a 4 s release: quiet
 *    engines never reached the target, 17 LU under the rest on a dyno pull, and a single shift bang
 *    held a whole 0–100 run 10–18 dB down.)
 * 2. A look-ahead peak limiter (`lookAheadS`, ceiling `ceilingDb`): the gain for each sample is the
 *    minimum over the look-ahead window of what every upcoming sample needs, smoothed, so it is
 *    already down when a peak leaves the delay line. No waveshaping, so no added harmonics.
 *
 * The output is delayed by the look-ahead (5 ms by default).
 */
export interface LevelerOptions {
  autoGain?: boolean;
  /** Loudness at full effort, LUFS. */
  targetLufs?: number;
  /** How far under `targetLufs` the target sits at zero effort (idle), dB. */
  dynamicsDb?: number;
  /** Level the peak guard keeps sustained peaks under, dBFS. */
  targetDb?: number;
  /** The most the peak guard may take off the loudness gain, dB. */
  maxPeakCutDb?: number;
  maxBoostDb?: number;
  maxCutDb?: number;
  attackS?: number;
  releaseS?: number;
  lookAheadS?: number;
  ceilingDb?: number;
  limiterReleaseS?: number;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Where the volume control may put recurring peaks, as a share of the ceiling (1 dB under it). */
const VOLUME_PEAK_ROOM = 0.89;
/** Gain at the top of the listener volume control, dB. */
export const VOLUME_TOP_DB = 12;

/**
 * Listener volume control, −100 … +100, to a linear gain. 0 leaves the level where the leveler puts
 * it. Below, the gain falls as the square of what is left ((100 + v) / 100)², −12 dB at −50 and
 * silence at −100, which is close to how a fader is heard. Above, it rises in decibels to
 * `VOLUME_TOP_DB` at +100. The gain sits between the rider and the limiter, so turning it up cannot
 * clip. Quiet running comes up by the whole amount. Full-load peaks are already 2.5 dB under the
 * ceiling, and the rider gives up only 1.5 dB of that (asking the limiter for more made it work
 * through half of a dyno pull): full load gains 1 to 2 dB at the top of the control, not 12, and
 * the idle to full-load swing narrows as the control goes up. More than that is the job of the
 * volume control of the device.
 */
export function volumeToGain(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  const v = Math.min(100, Math.max(-100, volume));
  if (v <= 0) return ((100 + v) / 100) * ((100 + v) / 100);
  return dbToGain((VOLUME_TOP_DB * v) / 100);
}

/** The rider updates its target every this many samples. */
const TARGET_BLOCK = 32;
/** The peak guard's 0.1 s windows (five 20 ms slices each) and how many it looks back over; slices a level must last to count at once. */
const PEAK_WINDOWS = 8;
const SLICES_PER_WINDOW = 5;
const PEAK_SLICES = 4;
/** Largest share one instant may add to the loudness reading, as a multiple of the running mean square. */
const OUTLIER = 8;
/** Below this loudness (LUFS, before gain) there is no engine to level: the gain stays where it is. */
const GATE_LUFS = -100;

/** One BS.1770 K-weighting channel: the high shelf and the RLB high-pass, as two biquads. */
class KWeight {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private readonly c1: number;
  private readonly c2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private z1 = 0;
  private z2 = 0;
  /** Weighted sample from the last `push`. */
  out = 0;
  constructor(fs: number) {
    // Analogue prototypes of the standard's 48 kHz filters, re-derived for this rate.
    const k = Math.tan((Math.PI * 1681.974450955533) / fs);
    const q = 0.7071752369554196;
    const vh = Math.pow(10, 3.999843853973347 / 20);
    const vb = Math.pow(vh, 0.4996667741545416);
    const a0 = 1 + k / q + k * k;
    this.b0 = (vh + (vb * k) / q + k * k) / a0;
    this.b1 = (2 * (k * k - vh)) / a0;
    this.b2 = (vh - (vb * k) / q + k * k) / a0;
    this.a1 = (2 * (k * k - 1)) / a0;
    this.a2 = (1 - k / q + k * k) / a0;
    const kh = Math.tan((Math.PI * 38.13547087602444) / fs);
    const qh = 0.5003270373238773;
    const c0 = 1 + kh / qh + kh * kh;
    this.c1 = (2 * (kh * kh - 1)) / c0;
    this.c2 = (1 - kh / qh + kh * kh) / c0;
  }
  push(x: number): void {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    const z = y - 2 * this.y1 + this.y2 - this.c1 * this.z1 - this.c2 * this.z2;
    this.y2 = this.y1;
    this.y1 = y;
    this.z2 = this.z1;
    this.z1 = z;
    this.out = z;
  }
}

export class OutputLeveler {
  autoGain: boolean;
  /**
   * How hard the engine is being worked, 0 (idle) … 1 (full load at the redline); the host sets it
   * each block from `EngineSimulator.effort`. Left at 1 the rider is a plain loudness normaliser.
   */
  effort = 1;
  /** Freeze the automatic gain (engine stopped or on the starter: nothing to level). */
  hold = false;
  /** Listener volume as a linear gain (`volumeToGain`), applied after the rider and before the limiter. */
  volume = 1;
  private volumeNow = 1;
  private readonly volumeCoef: number;
  private readonly fullMs: number;
  private readonly dynamicsNp: number;
  private readonly gateMs: number;
  private readonly peakTarget: number;
  private readonly peakFloor: number;
  private readonly maxBoost: number;
  private readonly minGain: number;
  private readonly attack: number;
  private readonly release: number;
  private readonly loudCoef: number;
  private readonly effortCoef: number;
  private readonly fastRelease: number;
  private readonly risingHold: number;
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
  private readonly kL: KWeight;
  private readonly kR: KWeight;
  /** K-weighted mean square of both channels (the loudness reading), and its target. */
  private ms = 0;
  /** How much of the loudness window has been heard yet, 0 … 1 (corrects the reading at the start). */
  private msFill = 0;
  private targetMs = 0;
  private effortSmooth = 1;
  /** Recurring peak level (see the peak guard), and the window peaks it is drawn from. */
  private envelope = 0;
  private readonly windowPeaks = new Float32Array(PEAK_WINDOWS);
  private readonly slicePeaks = new Float32Array(PEAK_SLICES);
  private readonly sliceLength: number;
  private slicePeak = 0;
  private sliceFill = 0;
  private sliceIndex = 0;
  private sustained = 0;
  private recurring = 0;
  /** Every peak, let go over 0.15 s: used while the effort is rising. */
  private fastPeak = 0;
  private rising = false;
  private risingLeft = 0;
  private windowPeak = 0;
  private windowFill = 0;
  private windowIndex = 0;
  private agc = 1;
  private lim = 1;
  /** Total gain applied to the most recent output sample (for meters), linear. */
  lastGain = 1;
  /** The limiter's share of it (1 = not limiting), linear. */
  lastLimiterGain = 1;

  constructor(private readonly sampleRate: number, options: LevelerOptions = {}) {
    this.autoGain = options.autoGain ?? true;
    // LUFS = −0.691 + 10·log10(mean square of the K-weighted channels, summed).
    this.fullMs = Math.pow(10, ((options.targetLufs ?? -8) + 0.691) / 10);
    this.dynamicsNp = ((options.dynamicsDb ?? 15) * Math.LN10) / 10;
    this.gateMs = Math.pow(10, (GATE_LUFS + 0.691) / 10);
    this.targetMs = this.fullMs;
    this.peakTarget = dbToGain(options.targetDb ?? -4.5);
    this.peakFloor = dbToGain(-(options.maxPeakCutDb ?? 20));
    this.maxBoost = dbToGain(options.maxBoostDb ?? 48);
    this.minGain = dbToGain(-(options.maxCutDb ?? 36));
    this.attack = 1 - Math.exp(-1 / ((options.attackS ?? 0.05) * sampleRate));
    this.release = 1 - Math.exp(-1 / ((options.releaseS ?? 2) * sampleRate));
    this.loudCoef = 1 - Math.exp(-1 / (0.4 * sampleRate));
    this.volumeCoef = 1 - Math.exp(-1 / (0.03 * sampleRate));
    this.effortCoef = 1 - Math.exp(-TARGET_BLOCK / (0.15 * sampleRate));
    this.sliceLength = Math.max(1, Math.round(0.02 * sampleRate));
    this.fastRelease = 1 - Math.exp(-1 / (0.15 * sampleRate));
    this.risingHold = Math.round(0.5 * sampleRate);
    this.ceiling = dbToGain(options.ceilingDb ?? -2);
    this.latency = Math.max(1, Math.round((options.lookAheadS ?? 0.005) * sampleRate));
    this.limRelease = 1 - Math.exp(-1 / ((options.limiterReleaseS ?? 0.08) * sampleRate));
    this.delayL = new Float32Array(this.latency + 1);
    this.delayR = new Float32Array(this.latency + 1);
    this.dqTime = new Float64Array(this.latency + 2);
    this.dqGain = new Float32Array(this.latency + 2);
    this.boxRing = new Float32Array(this.latency).fill(1);
    this.boxSum = this.latency;
    this.kL = new KWeight(sampleRate);
    this.kR = new KWeight(sampleRate);
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

      // 1. Loudness rider with a peak guard. The readings run with the automatic gain off as well,
      // so switching it on finds the level the engine has now and not the one it had when it went off.
      {
        if (this.time % TARGET_BLOCK === 0) {
          // The level goes on rising after the pedal has stopped moving (speed, boost), so the
          // fast reading stays on for half a second more.
          if (this.effort - this.effortSmooth > 0.05) this.risingLeft = this.risingHold;
          else if (this.risingLeft > 0) this.risingLeft -= TARGET_BLOCK;
          this.rising = this.risingLeft > 0;
          this.effortSmooth += (Math.min(1, Math.max(0, this.effort)) - this.effortSmooth) * this.effortCoef;
          this.targetMs = this.fullMs * Math.exp(-this.dynamicsNp * (1 - this.effortSmooth));
        }
        this.kL.push(l);
        this.kR.push(r);
        // An instant counts for at most 9 dB over the running loudness: a bang 30 dB over the engine
        // would otherwise sit in the average for two seconds. A real rise still gets through at
        // 75 dB/s. (The small constant lets the reading start from silence.)
        const most = (OUTLIER * this.ms) / (this.msFill + 1e-6) + 1e-7;
        let p = this.kL.out * this.kL.out + this.kR.out * this.kR.out;
        if (p > most) p = most;
        this.ms += (p - this.ms) * this.loudCoef;
        this.msFill += (1 - this.msFill) * this.loudCoef;
        if (peak > this.fastPeak) this.fastPeak = peak;
        else this.fastPeak += (peak - this.fastPeak) * this.fastRelease;
        // Recurring peak: the third largest of the last eight 0.1 s window peaks, or the level the
        // last 80 ms never fell under, whichever is higher.
        if (peak > this.slicePeak) this.slicePeak = peak;
        if (++this.sliceFill >= this.sliceLength) {
          if (this.slicePeak > this.windowPeak) this.windowPeak = this.slicePeak;
          this.slicePeaks[this.sliceIndex] = this.slicePeak;
          this.sliceIndex = (this.sliceIndex + 1) % PEAK_SLICES;
          this.slicePeak = 0;
          this.sliceFill = 0;
          let low = this.slicePeaks[0];
          for (let k = 1; k < PEAK_SLICES; k++) if (this.slicePeaks[k] < low) low = this.slicePeaks[k];
          this.sustained = low;
          if (++this.windowFill >= SLICES_PER_WINDOW) {
            this.windowPeaks[this.windowIndex] = this.windowPeak;
            this.windowIndex = (this.windowIndex + 1) % PEAK_WINDOWS;
            this.windowPeak = 0;
            this.windowFill = 0;
            let a = 0;
            let b = 0;
            let c = 0;
            for (let k = 0; k < PEAK_WINDOWS; k++) {
              const v = this.windowPeaks[k];
              if (v > a) {
                c = b;
                b = a;
                a = v;
              } else if (v > b) {
                c = b;
                b = v;
              } else if (v > c) c = v;
            }
            this.recurring = c;
          }
          this.envelope = this.recurring > this.sustained ? this.recurring : this.sustained;
        }
        if (!this.autoGain) this.agc = 1;
        else if (!this.hold && this.msFill > 0.2 && this.ms > this.gateMs * this.msFill) {
          const byLoudness = Math.sqrt((this.targetMs * this.msFill) / this.ms);
          const peaks = this.rising && this.fastPeak > this.envelope ? this.fastPeak : this.envelope;
          // With the volume turned up the guard keeps recurring peaks just under the ceiling, so the
          // limiter is not driven the whole time.
          const room = (this.ceiling * VOLUME_PEAK_ROOM) / Math.max(1, this.volumeNow);
          const byPeak = (room < this.peakTarget ? room : this.peakTarget) / Math.max(1e-9, peaks);
          let want = byLoudness;
          if (byPeak < want) want = Math.max(byPeak, byLoudness * this.peakFloor);
          if (want > this.maxBoost) want = this.maxBoost;
          else if (want < this.minGain) want = this.minGain;
          this.agc += (want - this.agc) * (want < this.agc ? this.attack : this.release);
        }
      }
      // Listener volume, moved over 30 ms so the control does not zip.
      this.volumeNow += (this.volume - this.volumeNow) * this.volumeCoef;
      const gain = this.agc * this.volumeNow;
      l *= gain;
      r *= gain;

      // 2. Look-ahead limiter. The gain each sample needs, minimum over the samples still in the delay
      // line (this one and the L before it), then a box average over L samples: every value in the
      // average already saw a peak by the time that peak leaves the delay line, so the gain applied to
      // it is never above what it needs, and the gain moves as a ramp rather than a step.
      const t = this.time;
      const w = t % size;
      this.delayL[w] = l;
      this.delayR[w] = r;
      const req = Math.min(1, this.ceiling / Math.max(1e-12, peak * gain));
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
      this.lastLimiterGain = g;
      this.time = t + 1;
    }
  }
}
