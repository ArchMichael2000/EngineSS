/**
 * Band-limited stereo upsampler: lets the simulator run at a reduced internal rate on machines
 * or configurations that cannot hold real time at the device rate (physics is rate-independent —
 * every delay, filter and integrator is derived from the sample rate).
 *
 * Kaiser-windowed sinc (β = 8, 32 taps), 256 phases with linear interpolation between phases,
 * cutoff 0.46·fs_in: images of the reduced-rate signal are attenuated by ≥ 70 dB.
 */

const HALF = 16;
const TAPS = 2 * HALF;
const PHASES = 256;
const BETA = 8;
const CUTOFF = 0.92; // fraction of the input Nyquist

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

let sharedTable: Float32Array | null = null;
/** Filter table [phase][tap], PHASES + 1 rows so phase interpolation never wraps. */
function table(): Float32Array {
  if (sharedTable) return sharedTable;
  const t = new Float32Array((PHASES + 1) * TAPS);
  const i0b = besselI0(BETA);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let k = 0; k < TAPS; k++) {
      // Tap k sits at input offset (k − HALF + 1) relative to the base sample; x = distance in samples.
      const x = k - HALF + 1 - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * CUTOFF * x) / (Math.PI * CUTOFF * x);
      const r = x / HALF;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(BETA * Math.sqrt(1 - r * r)) / i0b;
      t[p * TAPS + k] = sinc * w;
      sum += sinc * w;
    }
    for (let k = 0; k < TAPS; k++) t[p * TAPS + k] /= sum; // unity DC gain at every phase
  }
  sharedTable = t;
  return t;
}

export type BlockSource = (left: Float32Array, right: Float32Array, count: number) => void;

export class Upsampler {
  /** Input samples per output sample (< 1 when upsampling). */
  readonly step: number;
  private readonly h = table();
  private readonly size = 1024;
  private readonly bufL = new Float32Array(this.size);
  private readonly bufR = new Float32Array(this.size);
  private readonly chunkL = new Float32Array(64);
  private readonly chunkR = new Float32Array(64);
  /** Total input samples written. */
  private written = 0;
  /** Read position in input samples (absolute). */
  private pos = 0;

  constructor(inputRate: number, outputRate: number, private readonly source: BlockSource) {
    this.step = inputRate / outputRate;
    // Prime with the filter's look-ahead so the first output has its full support.
    this.pull(HALF + 1);
    this.pos = HALF - 1;
  }

  private pull(minimum: number): void {
    while (this.written < minimum) {
      const n = this.chunkL.length;
      this.source(this.chunkL, this.chunkR, n);
      const m = this.size - 1;
      for (let i = 0; i < n; i++) {
        const w = (this.written + i) & m;
        this.bufL[w] = this.chunkL[i];
        this.bufR[w] = this.chunkR[i];
      }
      this.written += n;
    }
  }

  process(left: Float32Array, right: Float32Array, count: number): void {
    const h = this.h;
    const m = this.size - 1;
    for (let i = 0; i < count; i++) {
      const base = Math.floor(this.pos);
      this.pull(base + HALF + 1);
      const ph = (this.pos - base) * PHASES;
      const p0 = Math.floor(ph);
      const pf = ph - p0;
      const r0 = p0 * TAPS;
      const r1 = r0 + TAPS;
      let accL = 0;
      let accR = 0;
      const start = base - HALF + 1;
      for (let k = 0; k < TAPS; k++) {
        const c = h[r0 + k] + (h[r1 + k] - h[r0 + k]) * pf;
        const j = (start + k) & m;
        accL += c * this.bufL[j];
        accR += c * this.bufR[j];
      }
      left[i] = accL;
      right[i] = accR;
      this.pos += this.step;
    }
  }
}

/** Internal-rate tiers as fractions of the device rate. */
export const RATE_TIERS = [1, 5 / 6, 2 / 3] as const;
