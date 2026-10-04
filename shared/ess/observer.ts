/**
 * Free-field listener. Each source is a compact monopole whose volume
 * acceleration q̇ produces p = ρ0·q̇(t − r/c)/(4πr) at each ear, plus a ground
 * image (asphalt reflection) and, where the vehicle body is in the way, a
 * shielding/transmission filter. Stereo comes from real source positions and
 * arrival times, never from panning.
 *
 * Vehicle frame: x lateral (+ right), y forward (+ front), z up, metres.
 */
import { C_AIR, RHO_AIR } from "./gas";
import { DelayLine } from "./waveguide";
import type { Vec3 } from "./exhaust";

export type Perspective = "exterior-rear" | "exterior-side" | "engine-bay" | "cabin" | "dyno-tailpipe";
export type SourceKind = "exhaust" | "intake" | "structure" | "accessory";

export interface SourceDef {
  kind: SourceKind;
  position: Vec3;
}

interface PathFilter {
  /** one-pole low-pass coefficient (0 = bypass) applied twice (second order) */
  k: number;
  gain: number;
  s1: number;
  s2: number;
}

interface Path {
  source: number;
  ear: number;
  delay: number;
  gain: number;
  filter: PathFilter;
}

export interface PerspectiveDef {
  label: string;
  ears: [Vec3, Vec3];
  /** dB SPL that maps to 0 dBFS. */
  fullScaleDbSpl: number;
  groundReflection: number;
  shielding(kind: SourceKind, source: Vec3): { cutoffHz: number; gainDb: number };
}

const ENGINE_Y = 1.5;

export const PERSPECTIVES: Record<Perspective, PerspectiveDef> = {
  "exterior-rear": {
    label: "Exterior — rear, 3 m",
    ears: [{ x: -0.09, y: -5.3, z: 1.2 }, { x: 0.09, y: -5.3, z: 1.2 }],
    fullScaleDbSpl: 118,
    groundReflection: 0.85,
    shielding: (kind, src) => (src.y > 0 ? { cutoffHz: 700, gainDb: -9 } : kind === "exhaust" ? { cutoffHz: 0, gainDb: 0 } : { cutoffHz: 1500, gainDb: -3 }),
  },
  "exterior-side": {
    label: "Exterior — side, 7.5 m (pass-by line)",
    ears: [{ x: 7.5, y: 0.09, z: 1.2 }, { x: 7.5, y: -0.09, z: 1.2 }],
    fullScaleDbSpl: 110,
    groundReflection: 0.85,
    shielding: (_kind, src) => (src.x < -0.2 ? { cutoffHz: 1200, gainDb: -4 } : { cutoffHz: 0, gainDb: 0 }),
  },
  "engine-bay": {
    label: "Engine bay — hood open, 0.6 m above engine",
    ears: [{ x: -0.1, y: ENGINE_Y + 0.1, z: 1.25 }, { x: 0.1, y: ENGINE_Y + 0.1, z: 1.25 }],
    fullScaleDbSpl: 122,
    groundReflection: 0.3,
    shielding: (kind, src) => (kind === "exhaust" && src.y < 0 ? { cutoffHz: 900, gainDb: -10 } : { cutoffHz: 0, gainDb: 0 }),
  },
  cabin: {
    label: "Cabin — driver's seat",
    ears: [{ x: -0.44, y: 0.05, z: 1.1 }, { x: -0.28, y: 0.05, z: 1.1 }],
    fullScaleDbSpl: 102,
    groundReflection: 0,
    // Body panels follow the mass law (~6 dB/oct); firewall and bulkheads add more for engine-bay sources.
    shielding: (kind, src) => (src.y > 0.6 ? { cutoffHz: 220, gainDb: -20 } : kind === "exhaust" ? { cutoffHz: 260, gainDb: -16 } : { cutoffHz: 300, gainDb: -18 }),
  },
  "dyno-tailpipe": {
    label: "Dyno cell — 0.5 m from the outlet",
    ears: [{ x: 0.25, y: -2.75, z: 0.55 }, { x: 0.45, y: -2.75, z: 0.55 }],
    fullScaleDbSpl: 136,
    groundReflection: 0.6,
    shielding: (kind, src) => (src.y > 0 ? { cutoffHz: 600, gainDb: -12 } : { cutoffHz: 0, gainDb: 0 }),
  },
};

export class Observer {
  private readonly lines: DelayLine[];
  private readonly paths: Path[] = [];
  readonly def: PerspectiveDef;
  /** Pa → full-scale factor for this perspective. */
  readonly paToFullScale: number;
  private boomL = 0;
  private boomR = 0;
  private boomBp1 = 0;
  private boomBp2 = 0;

  constructor(private readonly fs: number, perspective: Perspective, readonly sources: SourceDef[]) {
    this.def = PERSPECTIVES[perspective];
    this.paToFullScale = 1 / (2e-5 * Math.pow(10, this.def.fullScaleDbSpl / 20));
    let maxDelay = 16;
    const geometry: Array<{ s: number; e: number; r: number; image: boolean }> = [];
    sources.forEach((src, s) => {
      this.def.ears.forEach((ear, e) => {
        const r = Math.max(0.15, dist(src.position, ear));
        geometry.push({ s, e, r, image: false });
        if (this.def.groundReflection > 0) {
          const img = { ...src.position, z: -src.position.z };
          geometry.push({ s, e, r: Math.max(0.15, dist(img, ear)), image: true });
        }
      });
    });
    for (const g of geometry) maxDelay = Math.max(maxDelay, (g.r / C_AIR) * fs + 8);
    this.lines = sources.map(() => new DelayLine(maxDelay));
    for (const g of geometry) {
      const src = sources[g.s];
      const shield = this.def.shielding(src.kind, src.position);
      // The ground image stays coherent only at low frequency: finite ground impedance, turbulence
      // and the source's own extent decorrelate it above a few hundred Hz at these ranges (Daigle
      // 1979; Embleton 1996), so interference notches stay a few dB deep as in field recordings.
      const cutoff = g.image ? (shield.cutoffHz > 0 ? Math.min(shield.cutoffHz, 600) : 600) : shield.cutoffHz;
      const k = cutoff > 0 ? Math.exp((-2 * Math.PI * cutoff) / fs) : 0;
      const gain = (RHO_AIR / (4 * Math.PI * g.r)) * Math.pow(10, shield.gainDb / 20) * (g.image ? this.def.groundReflection : 1);
      this.paths.push({ source: g.s, ear: g.e, delay: Math.max(1.5, (g.r / C_AIR) * fs), gain, filter: { k, gain: 1, s1: 0, s2: 0 } });
    }
  }

  /**
   * @param q̇ per-source monopole volume acceleration this sample (m³/s²)
   * @param boom structure-borne cabin excitation (crank torque ripple, N·m), cabin only
   * @param out receives [left, right] in pascals
   */
  process(qdot: Float64Array, boom: number, out: Float64Array): void {
    for (let s = 0; s < this.lines.length; s++) this.lines[s].write(qdot[s]);
    let l = 0;
    let r = 0;
    for (let i = 0; i < this.paths.length; i++) {
      const p = this.paths[i];
      let x = this.lines[p.source].read(p.delay) * p.gain;
      const f = p.filter;
      if (f.k > 0) {
        f.s1 = x + f.k * (f.s1 - x);
        f.s2 = f.s1 + f.k * (f.s2 - f.s1);
        x = f.s2;
      }
      if (p.ear === 0) l += x;
      else r += x;
    }
    if (this.def === PERSPECTIVES.cabin) {
      // Engine-mount transmitted torque ripple → body panels → cabin "boom" (band 25–180 Hz).
      const kLo = Math.exp((-2 * Math.PI * 25) / this.fs);
      const kHi = Math.exp((-2 * Math.PI * 180) / this.fs);
      this.boomBp1 = boom + kHi * (this.boomBp1 - boom);
      this.boomBp2 = this.boomBp1 + kLo * (this.boomBp2 - this.boomBp1);
      const band = this.boomBp1 - this.boomBp2;
      // Gain: unverified against interior recordings (none open); set so WOT boom sits a few dB above
      // the airborne exhaust contribution, as interior order analyses of sporty cars show.
      this.boomL = band * 0.00175;
      this.boomR = band * 0.0016;
      l += this.boomL;
      r += this.boomR;
    }
    out[0] = l;
    out[1] = r;
  }
}

function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export const ENGINE_POSITION: Vec3 = { x: 0, y: ENGINE_Y, z: 0.65 };
export const INTAKE_MOUTH_POSITION: Vec3 = { x: 0.35, y: ENGINE_Y + 0.55, z: 0.75 };
