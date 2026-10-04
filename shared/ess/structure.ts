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

/**
 * Impact contact pulse: a critically damped two-pole low-pass whose rise time matches the contact
 * duration, so an impulse becomes a smooth force pulse with the right bandwidth (Hertzian contact).
 */
class ContactPulse {
  private y1 = 0;
  private y2 = 0;
  private readonly p: number;
  constructor(fs: number, contactSeconds: number) {
    this.p = Math.exp(-1 / Math.max(1, (contactSeconds * fs) / 2));
  }
  next(x: number): number {
    const g = (1 - this.p) * (1 - this.p);
    const y = g * x + 2 * this.p * this.y1 - this.p * this.p * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function runMode(m: Mode, x: number): number {
  const y = m.b0 * x - m.a1 * m.y1 - m.a2 * m.y2;
  m.y2 = m.y1;
  m.y1 = y;
  return y * m.gain;
}

/**
 * Modal mobilities (m/s per N at the modal filters' normalisation). Contact durations, mobilities,
 * the head-mode range and the timing-drive force level were fitted to HL-CEAD engine-bay statistics
 * (centroid, band split, flatness, order-locked share, crest factor at 1000–2000 rpm no-load);
 * see docs/reference-sources.md.
 */
const BLOCK_MOBILITY = 2.0e-6;
const HEAD_MOBILITY = 1.6e-6;

export class StructuralRadiator {
  private readonly blockModes: Mode[];
  private readonly headModes: Mode[];
  private readonly participation: Float64Array;
  private headImpulse = 0;
  private slapImpulse = 0;
  private prevVelocity = 0;
  private readonly pistonMass: number;
  private readonly seatPulse: ContactPulse;
  // Radiation efficiency below coincidence (RBJ high-pass state).
  private readonly hp = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
  private readonly slapPulse: ContactPulse;
  private readonly chainPulse: ContactPulse;
  /** Surface volume acceleration (m³/s²) radiated as a monopole. */
  volumeAcceleration = 0;

  constructor(
    private readonly fs: number,
    displacementL: number,
    cylinders: number,
    private readonly pistonArea: number,
    private readonly rng: Rng,
    positions: number[],
    /**
     * Drive train that excites the block between impacts. Four-strokes: the timing chain or belt on a
     * 21-tooth crank sprocket plus valvetrain friction. Two-strokes have neither (no camshaft, no
     * valves): only crank and bearing friction remain, without a tooth-pass tone.
     */
    private readonly drive: { teeth: number; level: number } = { teeth: 21, level: 1 },
  ) {
    // Larger engines have lower, denser modes (block bending/breathing scale ~ size^-1/3). Modal
    // density of plate-like covers and the block rises with frequency, so modes are spaced
    // geometrically with irregular jitter (a regular comb sounds like a tuned resonator).
    const scale = Math.pow(4 / clamp(displacementL, 0.3, 16), 0.28);
    const modeSet = (f0: number, f1: number, count: number) => {
      const out: number[] = [];
      for (let k = 0; k < count; k++) {
        const u = (k + 0.5 + 0.35 * (rng.next() - 0.5)) / count;
        out.push(f0 * Math.pow(f1 / f0, u) * scale);
      }
      return out;
    };
    const block = modeSet(450, 5200, 22);
    const head = modeSet(1500, 6000, 16);
    // Loss factor η ≈ 0.04–0.08 (bolted cast structures), ζ = η/2; gains fall ~f^-0.5 per mode
    // as the denser set shares the same input power.
    this.blockModes = block.map((f, k) => makeMode(f, 0.022 + 0.0012 * k, fs, 0.45 / Math.sqrt(1 + 0.12 * k)));
    this.headModes = head.map((f, k) => makeMode(f, 0.02 + 0.0015 * k, fs, 0.5 / Math.sqrt(1 + 0.18 * k)));
    // Contact durations: valve on seat insert ≈ 100 µs including valve-stem and spring compliance,
    // oil-cushioned piston slap ≈ 0.3 ms.
    // Piston mass scales with bore³ (≈ 0.33 kg at 86 mm).
    this.pistonMass = 0.33 * Math.pow(Math.sqrt((4 * pistonArea) / Math.PI) / 0.086, 3);
    this.seatPulse = new ContactPulse(fs, 100e-6);
    this.slapPulse = new ContactPulse(fs, 0.3e-3);
    // Roller-on-sprocket and guide contacts ≈ 150 µs: meshing force rolls off above ~2 kHz.
    this.chainPulse = new ContactPulse(fs, 150e-6);
    // Radiation efficiency of the block walls and covers rises ~f² below coincidence
    // (f_c ≈ 2.4 kHz for 5–8 mm aluminium/iron sections; Maidanik/Leppington), modelled as a
    // second-order high-pass on surface velocity.
    {
      const fc = 2400;
      const w = (2 * Math.PI * fc) / fs;
      const alpha = Math.sin(w) / (2 * 0.7);
      const cw = Math.cos(w);
      const a0 = 1 + alpha;
      this.hp.b0 = (1 + cw) / 2 / a0;
      this.hp.b1 = -(1 + cw) / a0;
      this.hp.b2 = (1 + cw) / 2 / a0;
      this.hp.a1 = (-2 * cw) / a0;
      this.hp.a2 = (1 - alpha) / a0;
    }
    // Signed mode-shape participation by position along the block.
    const len = Math.max(1e-3, Math.max(...positions) - Math.min(...positions));
    this.participation = new Float64Array(cylinders);
    positions.forEach((x, i) => {
      const u = (x - Math.min(...positions)) / len;
      this.participation[i] = 0.55 + 0.45 * Math.cos(Math.PI * u);
    });
  }

  /**
   * Valve seating impact, J = m·v (N·s): valve + half the spring ≈ 50 g, seating velocity set by the
   * closing ramp, ≈ 0.25 m/s at 6000 rpm and proportional to speed.
   */
  valveSeat(rpm: number, isExhaust: boolean): void {
    const v = 0.25 * (rpm / 6000);
    this.headImpulse += 0.05 * v * (isExhaust ? 1.1 : 1) * (0.7 + 0.6 * this.rng.next());
  }

  /**
   * Piston slap at the thrust-side reversal after firing TDC: the piston crosses its skirt
   * clearance (~30 µm) under side load F = p·A·(r/l)·sin θ (θ ≈ 20°), impact J = m·√(2Fc/m).
   */
  pistonSlap(pressureGaugePa: number, rodRatio: number): void {
    const side = Math.max(0, pressureGaugePa) * this.pistonArea * rodRatio * 0.35;
    const v = Math.sqrt((2 * side * 30e-6) / this.pistonMass);
    this.slapImpulse += this.pistonMass * v * (0.8 + 0.4 * this.rng.next());
  }

  /**
   * Timing drive and valvetrain friction: continuous excitation between impacts. A chain (or
   * belt) meshing with the crank sprocket gives a tone at the tooth-pass order plus broadband
   * meshing noise; power rises ~rpm³ (amplitude rpm^1.5), pegged to valve-seating power at the
   * same speed so the two keep their ratio across engine sizes.
   */
  private meshPhase = 0;
  /** Starter engaged: crank revolutions per second (0 = disengaged). */
  starterRevPerSec = 0;
  private starterMeshPhase = 0;
  private starterWhinePhase = 0;
  private mechanical(rpm: number): number {
    const k = Math.pow(Math.max(0, rpm) / 1000, 1.5);
    this.meshPhase += (2 * Math.PI * (rpm / 60) * Math.max(1, this.drive.teeth)) / this.fs;
    if (this.meshPhase > 1e4) this.meshPhase %= 2 * Math.PI;
    // Starter: pinion/ring-gear mesh (≈132 ring teeth) and commutator whine (≈13:1 reduction,
    // 24 commutator bars), bolted to the bellhousing, so it rides the block modes.
    let starter = 0;
    if (this.starterRevPerSec > 0) {
      const rps = this.starterRevPerSec;
      this.starterMeshPhase += (2 * Math.PI * rps * 132) / this.fs;
      this.starterWhinePhase += (2 * Math.PI * rps * 13 * 24) / this.fs;
      if (this.starterMeshPhase > 1e4) this.starterMeshPhase %= 2 * Math.PI;
      if (this.starterWhinePhase > 1e4) this.starterWhinePhase %= 2 * Math.PI;
      starter = 180 * Math.sin(this.starterMeshPhase) + 90 * Math.sin(this.starterWhinePhase) + 60 * this.rng.gaussian();
    }
    // High-frequency part of the chain tension fluctuation at the guides and tensioner, N (the
    // low-frequency part, hundreds of N, sits below the structure modes and does not radiate).
    const tone = this.drive.teeth > 0 ? 36 * Math.sin(this.meshPhase) : 0;
    return k * this.drive.level * (60 * this.rng.gaussian() + tone) + starter;
  }

  step(gaugePressures: Float64Array, scale: number, rpm = 0): void {
    // Forces in newtons: gas force on the crown carried into the block, impacts as N·s per sample.
    let force = 0;
    for (let i = 0; i < gaugePressures.length; i++) force += gaugePressures[i] * this.pistonArea * this.participation[i];
    // Timing drive acts on the front cover / block (guides and tensioner are bolted there).
    const mech = this.chainPulse.next(this.mechanical(rpm));
    const drive = force + this.slapPulse.next(this.slapImpulse * this.fs) + mech;
    this.slapImpulse = 0;
    let v = 0;
    for (let k = 0; k < this.blockModes.length; k++) v += runMode(this.blockModes[k], drive) * BLOCK_MOBILITY;
    const head = this.seatPulse.next(this.headImpulse * this.fs);
    this.headImpulse = 0;
    for (let k = 0; k < this.headModes.length; k++) v += runMode(this.headModes[k], head) * HEAD_MOBILITY;
    const h = this.hp;
    const radiating = h.b0 * v + h.b1 * h.x1 + h.b2 * h.x2 - h.a1 * h.y1 - h.a2 * h.y2;
    h.x2 = h.x1;
    h.x1 = v;
    h.y2 = h.y1;
    h.y1 = radiating;
    const velocity = radiating * scale;
    this.volumeAcceleration = (velocity - this.prevVelocity) * this.fs;
    this.prevVelocity = velocity;
  }
}
