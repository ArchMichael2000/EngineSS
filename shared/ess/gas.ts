/**
 * Gas properties, compressible orifice flow and deterministic noise.
 * SI units throughout (Pa, K, kg, m, s).
 */

export const R_AIR = 287.05;
export const P_AMBIENT = 101_325;
export const T_AMBIENT = 298.15;
export const GAMMA_AIR = 1.4;
/** Mean ratio of specific heats for in-cylinder / exhaust gas. */
export const GAMMA_GAS = 1.34;
export const CP_GAS = (GAMMA_GAS * R_AIR) / (GAMMA_GAS - 1);
export const CV_GAS = R_AIR / (GAMMA_GAS - 1);
export const CP_AIR = (GAMMA_AIR * R_AIR) / (GAMMA_AIR - 1);
export const RHO_AIR = P_AMBIENT / (R_AIR * T_AMBIENT);
export const C_AIR = Math.sqrt(GAMMA_AIR * R_AIR * T_AMBIENT);

export function speedOfSound(temperatureK: number, gamma = GAMMA_GAS): number {
  return Math.sqrt(gamma * R_AIR * Math.max(150, temperatureK));
}

export function density(pressurePa: number, temperatureK: number): number {
  return Math.max(1e-3, pressurePa) / (R_AIR * Math.max(150, temperatureK));
}

/**
 * Isentropic nozzle flow function Ψ(pr) for pr = p_down / p_up in [0, 1]:
 *   ṁ = CdA · p_up / sqrt(R·T_up) · Ψ(pr)
 * Choked below the critical ratio. Tabulated once (no transcendental calls in the audio loop).
 */
const FLOW_TABLE_SIZE = 2048;
const flowTable = new Float64Array(FLOW_TABLE_SIZE + 2);
(() => {
  const g = GAMMA_GAS;
  const critical = Math.pow(2 / (g + 1), g / (g - 1));
  const choked = Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  for (let i = 0; i <= FLOW_TABLE_SIZE + 1; i++) {
    const pr = Math.min(1, i / FLOW_TABLE_SIZE);
    flowTable[i] = pr <= critical
      ? choked
      : Math.sqrt(Math.max(0, ((2 * g) / (g - 1)) * (Math.pow(pr, 2 / g) - Math.pow(pr, (g + 1) / g))));
  }
})();

export function flowFunction(pr: number): number {
  if (pr >= 1) return 0;
  if (pr <= 0) return flowTable[0];
  const x = pr * FLOW_TABLE_SIZE;
  const i = x | 0;
  const f = x - i;
  return flowTable[i] + (flowTable[i + 1] - flowTable[i]) * f;
}

/**
 * Signed mass flow through an orifice from side a to side b (kg/s).
 * Near Δp → 0 the isentropic law has infinite slope; a laminar blend below
 * 0.4% pressure ratio keeps the implicit solvers well conditioned.
 */
export function orificeMassFlow(cdA: number, pa: number, ta: number, pb: number, tb: number): number {
  if (cdA <= 0) return 0;
  if (pa >= pb) {
    const up = pa;
    const pr = pb / up;
    return (cdA * up) / Math.sqrt(R_AIR * ta) * linearisedFlow(pr);
  }
  const up = pb;
  const pr = pa / up;
  return -(cdA * up) / Math.sqrt(R_AIR * tb) * linearisedFlow(pr);
}

const LAMINAR_PR = 0.996;
const LAMINAR_PSI = (() => {
  const g = GAMMA_GAS;
  return Math.sqrt(((2 * g) / (g - 1)) * (Math.pow(LAMINAR_PR, 2 / g) - Math.pow(LAMINAR_PR, (g + 1) / g)));
})();
function linearisedFlow(pr: number): number {
  if (pr <= LAMINAR_PR) return flowFunction(pr);
  return (LAMINAR_PSI * (1 - pr)) / (1 - LAMINAR_PR);
}

/** xorshift32 PRNG — deterministic, allocation free. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
  /** Uniform in [-1, 1). */
  bipolar(): number {
    return this.next() * 2 - 1;
  }
  /** Standard normal (Box–Muller, one value per call). */
  gaussian(): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/**
 * Band-limited turbulence noise: white noise through a 2-pole band-pass whose
 * centre follows a Strouhal frequency f = St·U/D (St ≈ 0.2, NASA jet-noise
 * literature). Unit RMS-ish output before scaling.
 */
export class BandNoise {
  private z1 = 0;
  private z2 = 0;
  private b0 = 0;
  private a1 = 0;
  private a2 = 0;
  private centre = -1;
  private norm = 1;
  constructor(private rng: Rng, private sampleRate: number, private q = 0.7) {}

  setCentre(hz: number): void {
    const f = Math.min(this.sampleRate * 0.42, Math.max(30, hz));
    if (Math.abs(f - this.centre) < this.centre * 0.02) return;
    this.centre = f;
    const w = (2 * Math.PI * f) / this.sampleRate;
    const alpha = Math.sin(w) / (2 * this.q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
    // Output variance of a resonant band-pass fed unit white noise ≈ π·f0 / (Q·fs) (equivalent noise bandwidth).
    this.norm = Math.sqrt((this.q * this.sampleRate) / (Math.PI * f));
  }

  next(): number {
    const x = this.rng.bipolar() * 1.7320508;
    // RBJ constant-peak band-pass, transposed direct form II
    const y = this.b0 * x + this.z1;
    this.z1 = -this.a1 * y + this.z2;
    this.z2 = -this.b0 * x - this.a2 * y;
    return y * this.norm;
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerpTable(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

/**
 * x^e by linear interpolation over [lo, hi] (no pow() in the audio loop). Clamped to the range;
 * with 4096 intervals over the wave-amplitude range the relative error stays below 1e-5.
 */
export class PowTable {
  private readonly table: Float64Array;
  private readonly scale: number;
  constructor(readonly exponent: number, private readonly lo: number, private readonly hi: number, intervals = 4096) {
    this.table = new Float64Array(intervals + 2);
    this.scale = intervals / (hi - lo);
    for (let i = 0; i <= intervals + 1; i++) this.table[i] = Math.pow(lo + i / this.scale, exponent);
  }
  at(x: number): number {
    const u = ((x < this.lo ? this.lo : x > this.hi ? this.hi : x) - this.lo) * this.scale;
    const i = u | 0;
    return this.table[i] + (this.table[i + 1] - this.table[i]) * (u - i);
  }
}

const waveTables = new Map<number, { k: PowTable; invK: PowTable; n: PowTable }>();
/** Exponent tables for finite-amplitude waves in a gas of ratio of specific heats γ. */
export function waveExponents(gamma: number): { k: PowTable; invK: PowTable; n: PowTable } {
  let t = waveTables.get(gamma);
  if (!t) {
    const k = (gamma - 1) / (2 * gamma);
    t = { k: new PowTable(k, 0.02, 12), invK: new PowTable(1 / k, 0.02, 1.6), n: new PowTable(2 / (gamma - 1), 0.02, 1.6) };
    waveTables.set(gamma, t);
  }
  return t;
}
