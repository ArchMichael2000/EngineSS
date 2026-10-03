/**
 * Structure-borne engine noise: a reduced set of block and head modes driven by
 * forces the simulation already computes —
 *  - combustion: rate of cylinder pressure rise × piston area (block "clatter"),
 *  - piston slap: side-thrust reversal impulse near firing TDC,
 *  - valvetrain: valve seating impacts at each computed closing event,
 * radiated as a compact monopole from the vibrating surface. Modal frequencies
 * scale with engine size; damping and radiation efficiency are family-typical
 * estimates (provenance: estimated-family, see docs/reference-sources.md).
 */
import { clamp, Rng } from "./gas";

interface Mode {
  b0: number;
  a1: number;
  a2: number;
  y1: number;
  y2: number;
  gain: number;
}

function makeMode(freq: number, zeta: number, fs: number, gain: number): Mode {
  const w = (2 * Math.PI * freq) / fs;
  const r = Math.exp(-zeta * w);
  return { b0: 1 - r, a1: -2 * r * Math.cos(w * Math.sqrt(Math.max(0, 1 - zeta * zeta))), a2: r * r, y1: 0, y2: 0, gain };
}

function runMode(m: Mode, x: number): number {
  const y = m.b0 * x - m.a1 * m.y1 - m.a2 * m.y2;
  m.y2 = m.y1;
  m.y1 = y;
  return y * m.gain;
}

export class StructuralRadiator {
  private readonly blockModes: Mode[];
  private readonly headModes: Mode[];
  private readonly participation: Float64Array;
  private headImpulse = 0;
  private slapImpulse = 0;
  private prevVelocity = 0;
  /** Surface volume acceleration (m³/s²) radiated as a monopole. */
  volumeAcceleration = 0;

  constructor(
    private readonly fs: number,
    displacementL: number,
    cylinders: number,
    private readonly pistonArea: number,
    private readonly rng: Rng,
    positions: number[],
  ) {
    // Larger engines have lower, denser modes (block bending/breathing scale ~ size^-1/3).
    const scale = Math.pow(4 / clamp(displacementL, 0.3, 16), 0.28);
    const block = [480, 760, 1060, 1450, 1980, 2650, 3500, 4600].map((f) => f * scale);
    const head = [1700, 2450, 3300, 4400, 5800, 7600].map((f) => f * scale);
    this.blockModes = block.map((f, k) => makeMode(f, 0.03 + 0.004 * k, fs, 1 / (1 + 0.12 * k)));
    this.headModes = head.map((f, k) => makeMode(f, 0.025 + 0.004 * k, fs, 1 / (1 + 0.18 * k)));
    // Signed mode-shape participation by position along the block.
    const len = Math.max(1e-3, Math.max(...positions) - Math.min(...positions));
    this.participation = new Float64Array(cylinders);
    positions.forEach((x, i) => {
      const u = (x - Math.min(...positions)) / len;
      this.participation[i] = 0.55 + 0.45 * Math.cos(Math.PI * u);
    });
  }

  /** Valve seating impact; closingSpeed ∝ cam velocity at the ramp (∝ rpm). */
  valveSeat(rpm: number, isExhaust: boolean): void {
    const v = rpm / 6000;
    this.headImpulse += (isExhaust ? 1.1 : 1) * v * Math.sqrt(v) * (0.7 + 0.6 * this.rng.next());
  }

  /** Piston slap near firing TDC; impulse ∝ gas side load ≈ p·A·(r/l). */
  pistonSlap(pressurePa: number, rodRatio: number): void {
    this.slapImpulse += (pressurePa * this.pistonArea * rodRatio) * 1e-4 * (0.8 + 0.4 * this.rng.next());
  }

  /**
   * @param pressureRates per-cylinder dp/dt (Pa/s)
   * @param scale overall structural radiation efficiency × area (calibrated against engine-bay recordings)
   */
  step(pressureRates: Float64Array, scale: number): void {
    let force = 0;
    for (let i = 0; i < pressureRates.length; i++) {
      // Only the sharp part of the pressure rise excites the structure: positive rates during combustion.
      const r = pressureRates[i];
      if (r > 0) force += r * this.pistonArea * this.participation[i];
    }
    const drive = force * 1.2e-12 + this.slapImpulse;
    this.slapImpulse = 0;
    let v = 0;
    for (let k = 0; k < this.blockModes.length; k++) v += runMode(this.blockModes[k], drive);
    const head = this.headImpulse;
    this.headImpulse = 0;
    for (let k = 0; k < this.headModes.length; k++) v += runMode(this.headModes[k], head * 2e-4);
    const velocity = v * scale;
    this.volumeAcceleration = (velocity - this.prevVelocity) * this.fs;
    this.prevVelocity = velocity;
  }
}
