/**
 * Master-and-link ("articulated") connecting rods, as every radial row uses: one cylinder's rod —
 * the master rod — runs on the crank pin, and the other cylinders' link rods hinge on knuckle
 * pins set around the master rod's big end. A link piston therefore follows the crank pin plus
 * the swing of the master rod, which shifts its top dead centre by a few crank degrees, changes
 * its stroke slightly and makes its motion asymmetric about TDC. Those per-cylinder differences
 * are what make a radial's firing intervals uneven and its exhaust note lope.
 *
 * Geometry, in the plane of the row, angles measured in the firing solver's sense (see
 * geometry.ts: the crank pin sits at angle φ − θ at crank angle θ):
 *   crank pin        P = r·u(φ − θ)
 *   master piston    on its bank axis β_m at s_m = P·u_m + √(L² − (P×u_m)²)
 *   master rod angle μ = direction of (s_m·u_m − P)
 *   knuckle pin i    K_i = P + r_k·u(μ + β_i − β_m)      (pins spaced like the cylinders)
 *   link piston i    on its axis β_i at s_i = K_i·u_i + √(L_l² − (K_i×u_i)²)
 */

const DEG = Math.PI / 180;

export interface ArticulatedRow {
  /** Bank axis of each cylinder of the row, degrees; index 0 is the master cylinder. */
  axesDeg: number[];
  /** Crank pin angle of the row, degrees. */
  pinDeg: number;
  crankRadius: number;
  /** Master rod length, centre to centre. */
  masterRod: number;
  /** Radius of the knuckle-pin circle about the crank-pin centre. */
  knuckleRadius: number;
  /** Link rod length, knuckle pin to piston pin. */
  linkRod: number;
}

/** Table resolution: samples per crank degree. */
export const MOTION_STEPS_PER_DEG = 4;

export interface PistonMotion {
  /** Crank angle of true TDC minus the plain-rod TDC (pin in line with the cylinder), degrees. */
  tdcOffsetDeg: number;
  /** Stroke (TDC to BDC travel), same unit as the lengths given. */
  stroke: number;
  /** Piston pin distance from the crank centre at TDC. */
  tdcDistance: number;
  /**
   * Displacement from TDC and its derivative per radian of crank, tabulated every
   * 1/MOTION_STEPS_PER_DEG degree after the cylinder's own TDC over one revolution (one extra
   * entry so interpolation can read i + 1).
   */
  displacement: Float64Array;
  rate: Float64Array;
}

/** Piston pin distance from the crank centre for cylinder `index` of the row at crank angle θ. */
export function articulatedDistance(row: ArticulatedRow, index: number, thetaDeg: number): number {
  return articulatedState(row, index, thetaDeg).distance;
}

/** Positions needed to draw or solve one cylinder of the row at crank angle θ (x right, y up in the solver's rear view). */
export function articulatedState(row: ArticulatedRow, index: number, thetaDeg: number): { distance: number; pin: [number, number]; knuckle: [number, number] } {
  const a = (row.pinDeg - thetaDeg) * DEG;
  const r = row.crankRadius;
  const px = r * Math.sin(a);
  const py = r * Math.cos(a);
  const bm = row.axesDeg[0] * DEG;
  const umx = Math.sin(bm);
  const umy = Math.cos(bm);
  const alongM = px * umx + py * umy;
  const acrossM = px * umy - py * umx;
  const sm = alongM + Math.sqrt(Math.max(0, row.masterRod * row.masterRod - acrossM * acrossM));
  if (index === 0) return { distance: sm, pin: [px, py], knuckle: [px, py] };
  // Master rod direction, then the knuckle pin swung round by the cylinder spacing.
  const mu = Math.atan2(sm * umx - px, sm * umy - py);
  const bi = row.axesDeg[index] * DEG;
  const k = mu + (bi - bm);
  const kx = px + row.knuckleRadius * Math.sin(k);
  const ky = py + row.knuckleRadius * Math.cos(k);
  const uix = Math.sin(bi);
  const uiy = Math.cos(bi);
  const along = kx * uix + ky * uiy;
  const across = kx * uiy - ky * uix;
  return { distance: along + Math.sqrt(Math.max(0, row.linkRod * row.linkRod - across * across)), pin: [px, py], knuckle: [kx, ky] };
}

/** Motion of every cylinder of a master-and-link row. */
export function articulatedMotion(row: ArticulatedRow): PistonMotion[] {
  return row.axesDeg.map((axis, index) => {
    const nominal = row.pinDeg - axis; // plain-rod TDC: pin in line with the cylinder
    const s = (theta: number) => articulatedDistance(row, index, theta);
    // TDC: golden-section search for the maximum of s near the nominal angle (it is within ±15°).
    let lo = nominal - 20;
    let hi = nominal + 20;
    const g = (Math.sqrt(5) - 1) / 2;
    let c = hi - g * (hi - lo);
    let d = lo + g * (hi - lo);
    let fc = s(c);
    let fd = s(d);
    for (let it = 0; it < 80; it++) {
      if (fc > fd) { hi = d; d = c; fd = fc; c = hi - g * (hi - lo); fc = s(c); } else { lo = c; c = d; fc = fd; d = lo + g * (hi - lo); fd = s(d); }
    }
    // The master rod is a plain rod: its TDC is the nominal angle exactly.
    const tdc = index === 0 ? nominal : 0.5 * (lo + hi);
    const top = s(tdc);
    const n = 360 * MOTION_STEPS_PER_DEG;
    const displacement = new Float64Array(n + 2);
    const rate = new Float64Array(n + 2);
    let bottom = top;
    const h = 0.01;
    for (let i = 0; i <= n + 1; i++) {
      const theta = tdc + i / MOTION_STEPS_PER_DEG;
      const here = s(theta);
      displacement[i] = top - here;
      rate[i] = -(s(theta + h) - s(theta - h)) / (2 * h * DEG);
      if (here < bottom) bottom = here;
    }
    displacement[0] = 0;
    return { tdcOffsetDeg: tdc - nominal, stroke: top - bottom, tdcDistance: top, displacement, rate };
  });
}

/**
 * Proportions used when a spec asks for articulated rods without giving them: knuckle circle 0.22 of
 * the master rod length, link rod = master rod − knuckle radius, so a link piston aligned with its
 * knuckle pin stands where the master piston would (family-typical for the Wasp and Cyclone engines;
 * estimated, see docs/reference-sources.md).
 */
export const KNUCKLE_RADIUS_RATIO = 0.22;
