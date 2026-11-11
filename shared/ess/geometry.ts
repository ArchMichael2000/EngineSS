/**
 * Crank / bank geometry and firing-schedule solver.
 *
 * Every cylinder i sits on a bank whose axis is at angle β (degrees from
 * vertical) and is driven by a crank throw at angle φ. With the crank turning
 * in the conventional sense (engine-sim's journal convention, under which the
 * GM V8 throws 0/270/90/180 give both 1-8-4-3-6-5-7-2 and 1-8-7-2-6-5-4-3),
 * the piston reaches TDC at crank angle c = φ − β (mod 360), so each
 * cylinder has two TDC candidates per 720° cycle, c and c + 360. A
 * four-stroke fires on exactly one of them. The solver picks those phases so
 * the requested firing order is honoured when the crank allows it, and
 * otherwise chooses the most even schedule the crank can physically produce.
 * Firing intervals are therefore *derived* from bank angle and throw layout
 * (45° V-twin → 315/405, 90° common-pin V6 → 90/150), never tabulated.
 */
import type { CrankSpec, EngineSpec, EssCrankType, EssLayout, CollectorStrategy, XLayoutSpec } from "./spec";
import { articulatedMotion } from "./rods";
import type { ArticulatedRow, PistonMotion } from "./rods";

export interface CylinderGeometry {
  /** 1-based cylinder number. */
  number: number;
  bank: number;
  /** Throw index along the crank (front = 0). */
  throwIndex: number;
  /** Longitudinal position along the block, metres from the front. */
  positionM: number;
  bankAxisDeg: number;
  pinAngleDeg: number;
  /** Firing TDC within the 720° cycle (cylinder in firing-order slot 0 fires at 0). */
  fireAngleDeg: number;
  /** Master-and-link rods: the row this cylinder belongs to (index into FiringSchedule.linkRows), its place in it (0 = master) and its piston motion (lengths in mm). */
  linkRow?: number;
  linkIndex?: number;
  motion?: PistonMotion;
}

export interface FiringSchedule {
  cylinders: CylinderGeometry[];
  /** Firing order actually realised (1-based). */
  firingOrder: number[];
  /** Interval after each event in `firingOrder`, degrees (sums to 720). */
  intervalsDeg: number[];
  bankCount: number;
  bankAxesDeg: number[];
  /** True when the requested firing order was feasible for the crank. */
  requestedOrderHonoured: boolean;
  notes: string[];
  /** Exhaust grouping must follow banks exactly (rotary: one port per rotor shared by its faces). */
  groupByBank?: boolean;
  /** Cross-Four: crank offset of each module, degrees. */
  moduleOffsetsDeg?: number[];
  /** Master-and-link rod rows (radials), lengths in mm. */
  linkRows?: ArticulatedRow[];
}

const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Rod plane (front to back) of cylinders 1–4 within a Cross-Four module: 1 · 3 · 2 · 4. */
export const X_PLANE_ORDER = [0, 2, 1, 3] as const;
/** Crank pin of cylinders 1–4 within a Cross-Four module, front view, degrees clockwise from "right". */
const X_PINS = [45, 135, 225, 315] as const;

export function bankLayout(layout: EssLayout, cylinders: number, bankAngleDeg: number, vrAngleDeg: number, xTilt = 15): {
  bankAxesDeg: number[];
  bankOf: (cyl: number) => number;
  throwOf: (cyl: number) => number;
} {
  const n = Math.max(1, Math.floor(cylinders));
  if (layout === "inline" || n === 1) {
    return { bankAxesDeg: [0], bankOf: () => 0, throwOf: (c) => c - 1 };
  }
  if (layout === "v" || layout === "flat") {
    const half = layout === "flat" ? Math.max(bankAngleDeg, 120) / 2 : bankAngleDeg / 2;
    return {
      bankAxesDeg: [-half, half],
      bankOf: (c) => (c % 2 === 1 ? 0 : 1),
      throwOf: (c) => Math.floor((c - 1) / 2),
    };
  }
  if (layout === "x") {
    // Cross-Four (see XLayoutSpec), in this file's convention (seen from the rear, so the crank
    // turns the same way as every other layout here): banks upper right, lower right, lower left,
    // upper left for cylinders 1–4 of each module; every cylinder has its own throw, in the rod-plane
    // order 1 · 3 · 2 · 4.
    const t = xTilt;
    return {
      bankAxesDeg: [90 - t, 90 + t, -90 - t, -90 + t],
      bankOf: (c) => (c - 1) % 4,
      throwOf: (c) => Math.floor((c - 1) / 4) * 4 + X_PLANE_ORDER[(c - 1) % 4],
    };
  }
  if (layout === "radial") {
    // Single row for odd counts; even counts are built as staggered rows (two rows of 7 or 9 as in
    // the R-2600/R-2800/R-3350, four rows of 7 for 28 as in the R-4360), one crank throw per row,
    // each row offset by a fraction of the cylinder spacing so the rows' cylinders interleave.
    const rows = radialRows(n);
    const perRow = n / rows;
    const spacing = 360 / perRow;
    // Cylinders are numbered in the direction the crank turns (as on real radials), so a single row
    // fires 1-3-5-7-9-2-4-6-8: the axis angle falls with the cylinder number, like the pin's.
    const axes = Array.from({ length: n }, (_, i) => {
      const row = Math.floor(i / perRow);
      return mod(-((i % perRow) * spacing + (row * spacing) / rows), 360);
    });
    return { bankAxesDeg: axes, bankOf: (c) => c - 1, throwOf: (c) => Math.floor((c - 1) / perRow) };
  }
  // W: four narrow banks (two VR pairs) when the count divides by 4, else a 3-bank broad arrow.
  if (n % 4 === 0 && n >= 8) {
    const h = bankAngleDeg / 2;
    const v = vrAngleDeg / 2;
    const axes = [-h - v, -h + v, h - v, h + v];
    return {
      bankAxesDeg: axes,
      bankOf: (c) => (c - 1) % 4,
      throwOf: (c) => Math.floor((c - 1) / 4) * 2 + ((c - 1) % 4 < 2 ? 0 : 1),
    };
  }
  const spread = bankAngleDeg;
  return {
    bankAxesDeg: [-spread, 0, spread],
    bankOf: (c) => (c - 1) % 3,
    throwOf: (c) => Math.floor((c - 1) / 3),
  };
}

/** Rows of a radial: odd counts are one row; even counts two rows (four for 28, 36). */
export function radialRows(n: number): number {
  if (n % 2 === 1 || n < 4) return 1;
  if (n >= 28 && n % 4 === 0) return 4;
  return 2;
}

/** Throw angles of a balanced even-firing inline crank with `m` throws. */
export function inlineCrankThrows(m: number): number[] {
  const known: Record<number, number[]> = {
    1: [0],
    2: [0, 180],
    3: [0, 240, 120],
    4: [0, 180, 180, 0],
    5: [0, 144, 216, 288, 72],
    6: [0, 120, 240, 240, 120, 0],
    7: [0, 102.857, 205.714, 308.571, 51.429, 154.286, 257.143],
    8: [0, 180, 90, 270, 270, 90, 180, 0],
  };
  if (known[m]) return known[m].slice();
  const step = 720 / m;
  return Array.from({ length: m }, (_, k) => mod(k * step, 360));
}

function throwAngles(type: EssCrankType, throws: number): number[] {
  switch (type) {
    case "cross-plane": {
      if (throws === 4) return [0, 270, 90, 180];
      if (throws === 2) return [0, 90];
      return Array.from({ length: throws }, (_, k) => mod(k * 90, 360));
    }
    case "flat-plane": {
      if (throws === 4) return [0, 180, 180, 0];
      return Array.from({ length: throws }, (_, k) => {
        const mirrored = Math.min(k, throws - 1 - k);
        return mirrored % 2 === 0 ? 0 : 180;
      });
    }
    case "single-pin":
      return Array(throws).fill(0);
    case "common-pin":
    default:
      return inlineCrankThrows(throws);
  }
}

function intervalsOf(sortedFire: number[]): number[] {
  return sortedFire.map((a, i) => (i + 1 < sortedFire.length ? sortedFire[i + 1] - a : 720 - a + sortedFire[0]));
}

function unevenness(fire: number[]): number {
  const sorted = fire.slice().sort((a, b) => a - b);
  const ideal = 720 / fire.length;
  let cost = 0;
  for (const d of intervalsOf(sorted)) cost += (d - ideal) * (d - ideal);
  return cost;
}

/**
 * Realise `order` with TDC candidates `c` (mod 360): choose each cylinder's
 * firing TDC (c or c + 360) so the events occur in exactly this order within
 * one 720° cycle, preferring the most even such schedule. Null when the crank
 * cannot fire in this order.
 *
 * Each cylinder has two candidates, so walking the order with "which candidate did the previous
 * cylinder take" as the state finds the optimum in O(n) (the former search tried all 2^(n−1)
 * combinations). Ties resolve as that search did: the lowest choice mask wins, highest cylinder
 * first.
 */
export function realiseOrder(order: number[], c: number[]): number[] | null {
  const n = c.length;
  if (order.length !== n) return null;
  const first = order[0] - 1;
  const ideal = 720 / n;
  // Candidate 0 / 1 of each cylinder, as offsets from the first cylinder in the order.
  const cand = (i: number, bit: number) => mod(c[i] - c[first] + (bit ? 360 : 0), 720);
  const forced = new Int8Array(n).fill(-1);
  const sq = (d: number) => (d - ideal) * (d - ideal);
  const solve = (): number => {
    // cost[b]: best cost with the previous cylinder in the order on candidate b.
    let prevA = 0;
    let costA = 0;
    let prevB = 0;
    let costB = Infinity;
    for (let k = 1; k < n; k++) {
      const i = order[k] - 1;
      let nA = Infinity;
      let nB = Infinity;
      const a = cand(i, 0);
      const b = cand(i, 1);
      if (forced[i] !== 1) {
        if (costA < Infinity && a > prevA + 1e-6) nA = Math.min(nA, costA + sq(a - prevA));
        if (costB < Infinity && a > prevB + 1e-6) nA = Math.min(nA, costB + sq(a - prevB));
      }
      if (forced[i] !== 0) {
        if (costA < Infinity && b > prevA + 1e-6) nB = Math.min(nB, costA + sq(b - prevA));
        if (costB < Infinity && b > prevB + 1e-6) nB = Math.min(nB, costB + sq(b - prevB));
      }
      prevA = a;
      prevB = b;
      costA = nA;
      costB = nB;
    }
    return Math.min(costA + sq(720 - prevA), costB + sq(720 - prevB));
  };
  const best = solve();
  if (!(best < Infinity)) return null;
  for (let i = n - 1; i >= 0; i--) {
    if (i === first) continue;
    forced[i] = 0;
    if (!(solve() <= best + 1e-7)) forced[i] = 1;
  }
  return Array.from({ length: n }, (_, i) => (i === first ? 0 : cand(i, forced[i])));
}

/**
 * The most even firing schedule a crank allows. Cylinder i reaches TDC at c[i] (mod 360) and fires
 * on that revolution or the next; the schedule minimises Σ(interval − 720/n)², then the number of
 * consecutive firings on adjacent throws (bearing load; how real orders are chosen. A multi-row
 * radial's throws are its rows, and real ones alternate rows every event).
 *
 * Solved exactly by dynamic programming over the cylinders sorted by TDC: the firing sequence is
 * the first-revolution cylinders in TDC order followed by the second-revolution ones, so the cost
 * so far depends only on the last cylinder placed on each revolution. That is O(n³) per evaluation
 * where the former search was O(2ⁿ) (12 s for 24 cylinders, doubling per cylinder). Ties resolve as
 * that search did: among equal schedules the highest-numbered cylinders keep the first TDC after
 * cylinder 1's.
 */
export function optimalSchedule(c: number[], throwOf: (cyl: number) => number, radial = false): number[] {
  const n = c.length;
  if (n === 1) return [0];
  const ideal = 720 / n;
  const rel = c.map((x) => mod(x - c[0], 360));
  const sorted = rel.map((r, i) => [r, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const R = Float64Array.from(sorted, (t) => t[0]);
  const C = sorted.map((t) => t[1]);
  const throws = C.map((i) => throwOf(i + 1));
  const g = (p: number, q: number, gap: number): number => {
    const adjacent = radial ? throws[p] === throws[q] : Math.abs(throws[p] - throws[q]) === 1;
    return (gap - ideal) * (gap - ideal) + (adjacent ? 1e-3 : 0);
  };
  // forced[p]: −1 free, 0 first revolution, 1 second revolution (by sorted position).
  const forced = new Int8Array(n).fill(-1);
  forced[0] = 0;
  let a = new Float64Array(n);
  let b = new Float64Array(n);
  let na = new Float64Array(n);
  let nb = new Float64Array(n);
  const solve = (): number => {
    let best = Infinity;
    // Every cylinder on the first revolution.
    {
      let cost = 0;
      let ok = true;
      for (let p = 1; p < n && ok; p++) {
        ok = forced[p] !== 1;
        cost += g(p - 1, p, R[p] - R[p - 1]);
      }
      if (ok) best = cost + g(n - 1, 0, 720 - R[n - 1]);
    }
    // fb: first cylinder (in TDC order) on the second revolution.
    let prefix = 0;
    for (let fb = 1; fb < n; fb++) {
      if (fb > 1) {
        if (forced[fb - 1] === 1) break;
        prefix += g(fb - 2, fb - 1, R[fb - 1] - R[fb - 2]);
      }
      if (forced[fb] === 0) continue;
      // a[j]: previous cylinder on revolution A, last B cylinder j. b[j]: previous on B, last A cylinder j.
      a.fill(Infinity);
      b.fill(Infinity);
      b[fb - 1] = prefix;
      for (let p = fb + 1; p < n; p++) {
        na.fill(Infinity);
        nb.fill(Infinity);
        const step = R[p] - R[p - 1];
        for (let j = 0; j < p - 1; j++) {
          const ca = a[j];
          const cb = b[j];
          if (ca < Infinity) {
            if (forced[p] !== 1) na[j] = Math.min(na[j], ca + g(p - 1, p, step));
            if (forced[p] !== 0) nb[p - 1] = Math.min(nb[p - 1], ca + g(j, p, R[p] - R[j]));
          }
          if (cb < Infinity) {
            if (forced[p] !== 1) na[p - 1] = Math.min(na[p - 1], cb + g(j, p, R[p] - R[j]));
            if (forced[p] !== 0) nb[j] = Math.min(nb[j], cb + g(p - 1, p, step));
          }
        }
        [a, na] = [na, a];
        [b, nb] = [nb, b];
      }
      for (let j = 0; j < n - 1; j++) {
        // Close the cycle: last A → first B (one revolution on), and last B → the first cylinder.
        if (a[j] < Infinity) best = Math.min(best, a[j] + g(n - 1, fb, R[fb] + 360 - R[n - 1]) + g(j, 0, 360 - R[j]));
        if (b[j] < Infinity) best = Math.min(best, b[j] + g(j, fb, R[fb] + 360 - R[j]) + g(n - 1, 0, 360 - R[n - 1]));
      }
    }
    return best;
  };
  const best = solve();
  const position = new Array<number>(n);
  C.forEach((cyl, p) => { position[cyl] = p; });
  for (let cyl = n - 1; cyl >= 1; cyl--) {
    const p = position[cyl];
    // The former search's zero choice: the first TDC after cylinder 1's, in absolute crank angle.
    const preferred = mod(c[cyl] - c[0], 720) >= 360 ? 1 : 0;
    forced[p] = preferred;
    if (!(solve() <= best + 1e-7)) forced[p] = 1 - preferred;
  }
  return rel.map((r, i) => mod(r + (forced[position[i]] === 1 ? 360 : 0), 720));
}

// ---------------------------------------------------------------------------------------------
// Cross-Four X engine: module phasing. Ported from the owner's Saber kinematic study, whose results
// these functions reproduce for the same tilt, module count and rod ratio.

/** Gaps between a Cross-Four's outer-dead-centre events over one revolution, degrees. Each module contributes two, 90° + 2t apart. */
export function xPulseGaps(offsetsDeg: number[], tiltDeg: number): number[] {
  const ev: number[] = [];
  for (const d of offsetsDeg) {
    ev.push(mod(135 + tiltDeg - d, 360));
    ev.push(mod(45 - tiltDeg - d, 360));
  }
  ev.sort((a, b) => a - b);
  return ev.map((v, i) => (i + 1 < ev.length ? ev[i + 1] : ev[0] + 360) - v);
}

function xPulseScore(offsets: number[], t: number): number {
  const g = xPulseGaps(offsets, t);
  const ideal = 360 / g.length;
  return g.reduce((sum, v) => sum + (v - ideal) * (v - ideal), 0);
}

/** Module crank offsets (whole degrees) that spread the power pulses as evenly as the tilt allows. */
export function xEvenFiringOffsets(modules: number, tiltDeg: number): number[] {
  const n = modules;
  if (n <= 1) return [0];
  let best: { s: number; off: number[] } | null = null;
  for (const base of [360 / n, 180 / n, 180]) {
    const off = Array.from({ length: n }, (_, k) => Math.round(k * base) % 360);
    let s = xPulseScore(off, tiltDeg);
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      for (let k = 1; k < n; k++) {
        let bestD = off[k];
        let bestS = s;
        for (let d = 0; d < 360; d++) {
          off[k] = d;
          const sc = xPulseScore(off, tiltDeg);
          if (sc < bestS - 1e-9) { bestS = sc; bestD = d; }
        }
        off[k] = bestD;
        if (bestS < s - 1e-9) { s = bestS; improved = true; }
      }
      if (!improved) break;
    }
    if (!best || s < best.s) best = { s, off: off.slice() };
  }
  return best!.off;
}

/**
 * Piston acceleration of cylinders 1–4 of a module per unit ω², mm, at whole crank degrees 0…719
 * (second difference over ±1°), and each cylinder's axis direction. The arithmetic follows the
 * study's expression for expression, so searches that end in a tie between mirror-image
 * solutions break it the same way.
 */
function xAccelerationTables(tiltDeg: number, crankRadiusMm: number, rodMm: number): { acc: Float64Array[]; ux: number[]; uy: number[] } {
  const rad = (d: number) => (d * Math.PI) / 180;
  const axes = [180 + tiltDeg, 180 - tiltDeg, tiltDeg, -tiltDeg];
  const ux = axes.map((a) => Math.cos(rad(a)));
  const uy = axes.map((a) => Math.sin(rad(a)));
  const travel = (id: number, th: number) => {
    const pa = rad(X_PINS[id] + th);
    const px = crankRadiusMm * Math.cos(pa);
    const py = crankRadiusMm * Math.sin(pa);
    const pu = px * ux[id] + py * uy[id];
    const pn = -px * uy[id] + py * ux[id];
    return pu + Math.sqrt(rodMm * rodMm - pn * pn);
  };
  const h = rad(1);
  const acc = axes.map((_, id) => {
    const table = new Float64Array(720);
    for (let th = 0; th < 720; th++) table[th] = (travel(id, th + 1) - 2 * travel(id, th) + travel(id, th - 1)) / (h * h);
    return table;
  });
  return { acc, ux, uy };
}

/**
 * Peak reciprocating rocking couple of a Cross-Four over one revolution, per unit piston mass and
 * ω², in mm² (the study's "m·ω²·u²"), about the engine's centre. Offsets are whole degrees.
 */
export function xRockingCouple(offsetsDeg: number[], tiltDeg: number, crankRadiusMm: number, rodMm: number, planePitchMm: number, stepDeg = 2): number {
  return rockingPeak(xAccelerationTables(tiltDeg, crankRadiusMm, rodMm), offsetsDeg, planePitchMm, stepDeg);
}

function rockingPeak(tables: ReturnType<typeof xAccelerationTables>, offsets: number[], pitch: number, stepDeg: number): number {
  const n = offsets.length;
  const planes = 4 * n;
  let peak = 0;
  for (let d = 0; d < 360; d += stepDeg) {
    let mx = 0;
    let my = 0;
    for (let k = 0; k < n; k++) {
      const th = d + mod(Math.round(offsets[k]), 360);
      for (let id = 0; id < 4; id++) {
        const a = tables.acc[id][th];
        const y = (4 * k + X_PLANE_ORDER[id] - (planes - 1) / 2) * pitch;
        mx += a * y * tables.ux[id];
        my += a * y * tables.uy[id];
      }
    }
    peak = Math.max(peak, Math.hypot(mx, my));
  }
  return peak;
}

/** Module crank offsets (whole degrees) that minimise the rocking couple; pulse evenness breaks ties. */
export function xLowCoupleOffsets(modules: number, tiltDeg: number, crankRadiusMm: number, rodMm: number): number[] {
  const n = modules;
  if (n <= 1) return [0];
  const tables = xAccelerationTables(tiltDeg, crankRadiusMm, rodMm);
  // The couple scales with the pitch, so the best offsets do not depend on it (the study's reference pitch).
  const cost = (off: number[]) => rockingPeak(tables, off, 46, 6) + 0.01 * xPulseScore(off, tiltDeg);
  const starts = [
    Array.from({ length: n }, (_, k) => Math.round((k * 360) / n) % 360),
    Array.from({ length: n }, (_, k) => Math.round((k * 180) / n) % 360),
    xEvenFiringOffsets(n, tiltDeg),
  ];
  let best: { c: number; off: number[] } | null = null;
  for (const s0 of starts) {
    const off = s0.slice();
    let c = cost(off);
    for (const step of [15, 5, 1]) {
      for (let pass = 0; pass < 3; pass++) {
        let improved = false;
        for (let k = 1; k < n; k++) {
          const base = off[k];
          const span = step === 15 ? 180 : step * 3;
          let bestD = base;
          let bestC = c;
          for (let dd = -span; dd <= span; dd += step) {
            off[k] = mod(base + dd, 360);
            const cc = cost(off);
            if (cc < bestC - 1e-9) { bestC = cc; bestD = off[k]; }
          }
          off[k] = bestD;
          if (bestC < c - 1e-9) { c = bestC; improved = true; }
        }
        if (!improved) break;
      }
    }
    if (!best || c < best.c) best = { c, off: off.slice() };
  }
  return best!.off;
}

const xOffsetCache = new Map<string, number[]>();

/** The module offsets a Cross-Four spec asks for (searches are cached: they run on every edit in the app). */
export function xModuleOffsets(x: XLayoutSpec, modules: number, crankRadiusMm: number, rodMm: number): number[] {
  if (x.phasing === "custom" && x.moduleOffsetsDeg?.length === modules) return x.moduleOffsetsDeg.map((d) => mod(d, 360));
  const lowCouple = x.phasing === "low-couple";
  const key = `${lowCouple ? "c" : "f"}/${modules}/${x.tiltDeg}/${lowCouple ? (rodMm / crankRadiusMm).toFixed(4) : ""}`;
  let off = xOffsetCache.get(key);
  if (!off) {
    off = lowCouple ? xLowCoupleOffsets(modules, x.tiltDeg, crankRadiusMm, rodMm) : xEvenFiringOffsets(modules, x.tiltDeg);
    if (xOffsetCache.size > 400) xOffsetCache.clear();
    xOffsetCache.set(key, off);
  }
  return off.slice();
}

export function defaultFiringOrder(layout: EssLayout, cylinders: number, crank: EssCrankType): number[] {
  const table: Record<string, number[]> = {
    "inline-2": [1, 2],
    "inline-3": [1, 2, 3],
    "inline-4": [1, 3, 4, 2],
    "inline-5": [1, 2, 4, 5, 3],
    "inline-6": [1, 5, 3, 6, 2, 4],
    "inline-8": [1, 6, 2, 5, 8, 3, 7, 4],
    "v-6": [1, 2, 3, 4, 5, 6],
    "v-8-cross-plane": [1, 8, 4, 3, 6, 5, 7, 2],
    "v-8-flat-plane": [1, 8, 3, 6, 4, 5, 2, 7],
    "v-12": [1, 12, 5, 8, 3, 10, 6, 7, 2, 11, 4, 9],
    "flat-4": [1, 4, 2, 3],
    "flat-6": [1, 6, 3, 2, 5, 4],
  };
  const key8 = layout === "v" && cylinders === 8 ? `v-8-${crank === "cross-plane" ? "cross-plane" : "flat-plane"}` : "";
  return (key8 && table[key8]) || table[`${layout}-${cylinders}`] || [];
}

export function solveFiringSchedule(spec: Pick<EngineSpec, "layout" | "cylinders" | "bankAngleDeg" | "vrAngleDeg" | "crank" | "firingOrder" | "borePitchMm"> & Partial<Pick<EngineSpec, "cycle" | "x" | "strokeMm" | "rodLengthMm" | "linkRods">>): FiringSchedule {
  const n = Math.max(1, Math.floor(spec.cylinders));
  const notes: string[] = [];
  const cross = spec.layout === "x" && n % 4 === 0 && spec.cycle !== "rotary" ? spec.x ?? { tiltDeg: 15, phasing: "even-firing" as const, planePitchMm: 46 } : null;
  const { bankAxesDeg, bankOf, throwOf } = bankLayout(cross ? "x" : spec.layout === "x" ? "inline" : spec.layout, n, spec.bankAngleDeg, spec.vrAngleDeg, cross?.tiltDeg);
  // Cross-Four: every cylinder on its own pin, the module's four pins 90° apart, each module clocked by its offset.
  let crossPins: number[] | null = null;
  let moduleOffsets: number[] | undefined;
  if (cross) {
    const stroke = spec.strokeMm ?? 190;
    moduleOffsets = xModuleOffsets(cross, n / 4, stroke / 2, spec.rodLengthMm ?? stroke * 2.105);
    crossPins = Array.from({ length: n }, (_, i) => mod(-(X_PINS[i % 4] + 90 + moduleOffsets![Math.floor(i / 4)]), 360));
  }
  const pitch = (cross ? cross.planePitchMm : spec.borePitchMm || 100) / 1000;
  if (spec.cycle === "two-stroke") {
    const tdc = crossPins ? crossPins.map((p, i) => mod(p - bankAxesDeg[bankOf(i + 1)], 360)) : null;
    return { ...twoStrokeSchedule(spec, n, bankAxesDeg, bankOf, throwOf, pitch, tdc), moduleOffsetsDeg: moduleOffsets };
  }
  if (spec.cycle === "rotary") return rotarySchedule(spec, n);
  const crank: CrankSpec = spec.crank;
  const throwCount = Math.max(...Array.from({ length: n }, (_, i) => throwOf(i + 1))) + 1;

  let pins: number[];
  let fire: number[] | null = null;
  let honoured = false;

  if (crank.type === "custom" && crank.fireAnglesDeg?.length === n) {
    fire = crank.fireAnglesDeg.map((a) => mod(a - crank.fireAnglesDeg![0], 720));
    pins = Array.from({ length: n }, (_, i) => mod(fire![i] + bankAxesDeg[bankOf(i + 1)], 360));
    honoured = true;
  } else if (crank.type === "even-fire" && !cross) {
    const tableOrder = defaultFiringOrder(spec.layout, n, "cross-plane");
    const requested = validOrder(spec.firingOrder, n) ? spec.firingOrder : validOrder(tableOrder, n) ? tableOrder : evenDefaultOrder(n, throwOf);
    fire = new Array(n);
    requested.forEach((cyl, k) => { fire![cyl - 1] = (k * 720) / n; });
    pins = Array.from({ length: n }, (_, i) => mod(fire![i] + bankAxesDeg[bankOf(i + 1)], 360));
    honoured = validOrder(spec.firingOrder, n);
  } else {
    const throwTable = crank.type === "custom" && crank.pinAnglesDeg?.length === n
      ? null
      : throwAngles(crank.type, throwCount);
    // A multi-row radial's "single pin" is one pin per row, the rows' pins evenly spaced.
    const radialThrows = spec.layout === "radial" && crank.type === "single-pin" && throwCount > 1;
    pins = crossPins ?? Array.from({ length: n }, (_, i) => crank.type === "custom" && crank.pinAnglesDeg?.length === n
      ? crank.pinAnglesDeg[i]
      : radialThrows
        ? (throwOf(i + 1) * 360) / throwCount
        : throwTable![throwOf(i + 1)] ?? 0);
    let c = pins.map((p, i) => mod(p - bankAxesDeg[bankOf(i + 1)], 360));
    let optimal = optimalSchedule(c, throwOf, spec.layout === "radial");
    if (radialThrows && throwCount === 2 && unevenness(optimal) > 1) {
      // Rows of an even count can't interleave evenly with pins 180° apart (2 × 4: 45/90/135°);
      // another pin offset can (2 × 4 at 135°: even 90°). Search offsets on the 180°/n grid.
      let bestCost = unevenness(optimal);
      for (let k = 1; k < 2 * n; k++) {
        const offset = (k * 180) / n;
        const trialPins = Array.from({ length: n }, (_, i) => (throwOf(i + 1) === 1 ? offset : 0));
        const trialC = trialPins.map((p, i) => mod(p - bankAxesDeg[bankOf(i + 1)], 360));
        const trial = optimalSchedule(trialC, throwOf, true);
        const cost = unevenness(trial);
        if (cost < bestCost - 1) {
          bestCost = cost;
          optimal = trial;
          pins = trialPins;
          c = trialC;
        }
      }
    }
    if (validOrder(spec.firingOrder, n)) {
      fire = realiseOrder(spec.firingOrder, c);
      honoured = !!fire;
      if (!fire) notes.push(`Firing order ${spec.firingOrder.join("-")} is not achievable with this crank; using the most even order it allows.`);
    } else {
      // A conventional order is used only when it is as even as anything the crank allows.
      const conventional = defaultFiringOrder(spec.layout, n, crank.type);
      const realised = validOrder(conventional, n) ? realiseOrder(conventional, c) : null;
      if (realised && unevenness(realised) <= unevenness(optimal) + 1) fire = realised;
    }
    if (!fire) fire = optimal;
  }

  const cylindersGeom: CylinderGeometry[] = Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    bank: bankOf(i + 1),
    throwIndex: throwOf(i + 1),
    positionM: throwOf(i + 1) * pitch + (spec.layout === "v" || spec.layout === "flat" ? bankOf(i + 1) * pitch * 0.18 : 0),
    bankAxisDeg: bankAxesDeg[bankOf(i + 1)],
    pinAngleDeg: mod(pins[i], 360),
    fireAngleDeg: mod(fire![i], 720),
  }));
  // Master-and-link rods: each link piston reaches TDC a few degrees off its plain-rod angle, and
  // the ignition is timed to its own TDC (compensated magneto cams), so the firing angles shift too.
  let linkRows: ArticulatedRow[] | undefined;
  const link = spec.linkRods;
  const explicit = crank.type === "custom" && crank.fireAnglesDeg?.length === n;
  if (link && spec.layout === "radial" && !explicit && spec.strokeMm && spec.rodLengthMm) {
    linkRows = [];
    for (let row = 0; row < throwCount; row++) {
      const members = cylindersGeom.filter((c) => c.throwIndex === row);
      if (members.length < 2) continue;
      const def: ArticulatedRow = { axesDeg: members.map((c) => c.bankAxisDeg), pinDeg: members[0].pinAngleDeg, crankRadius: spec.strokeMm / 2, masterRod: spec.rodLengthMm, knuckleRadius: link.knuckleRadiusMm, linkRod: link.lengthMm };
      const motion = articulatedMotion(def);
      members.forEach((c, k) => {
        c.linkRow = linkRows!.length;
        c.linkIndex = k;
        c.motion = motion[k];
        c.fireAngleDeg = mod(c.fireAngleDeg + motion[k].tdcOffsetDeg, 720);
      });
      linkRows.push(def);
    }
    if (linkRows.length) notes.push("Master-and-link rods: link cylinders reach TDC up to a few degrees early or late.");
  }
  // A shift of under a degree must not move a cylinder from the start of the cycle to its end.
  const startOf = (a: number) => (linkRows?.length && a > 700 ? a - 720 : a);
  const order = cylindersGeom.slice().sort((a, b) => startOf(a.fireAngleDeg) - startOf(b.fireAngleDeg));
  // Normalise so the first cylinder in the order fires at 0.
  const zero = order[0].fireAngleDeg;
  for (const cyl of cylindersGeom) cyl.fireAngleDeg = mod(cyl.fireAngleDeg - zero, 720);
  const sorted = order.map((cyl) => cyl.fireAngleDeg);
  let intervals = intervalsOf(sorted);
  if (n === 1) intervals = [720];

  const ideal = 720 / n;
  if (intervals.some((d) => Math.abs(d - ideal) > 0.5)) {
    notes.push(`Uneven firing: ${intervals.map((d) => Math.round(d)).join("/")}°.`);
  }
  return {
    cylinders: cylindersGeom,
    firingOrder: order.map((cyl) => cyl.number),
    intervalsDeg: intervals,
    bankCount: bankAxesDeg.length,
    bankAxesDeg,
    requestedOrderHonoured: honoured,
    notes,
    moduleOffsetsDeg: moduleOffsets,
    linkRows,
  };
}

/**
 * Two-stroke: every TDC is a firing TDC, so the cycle is one revolution. Even firing spaces the
 * cylinders 360/n apart in firing order (parallel twins 180°, triples 120°); explicit fire angles
 * (mod 360) are honoured, e.g. a 360° "big-bang" twin with both at 0.
 */
function twoStrokeSchedule(
  spec: Pick<EngineSpec, "layout" | "crank" | "firingOrder" | "borePitchMm">,
  n: number,
  bankAxesDeg: number[],
  bankOf: (cyl: number) => number,
  throwOf: (cyl: number) => number,
  pitch: number,
  /** TDC of each cylinder when the crank geometry fixes it (Cross-Four); otherwise an even-firing crank is assumed. */
  tdc: number[] | null,
): FiringSchedule {
  const fire = new Array<number>(n).fill(0);
  let honoured = false;
  if (tdc && spec.crank.fireAnglesDeg?.length !== n) {
    tdc.forEach((a, i) => { fire[i] = a; });
    const zero = Math.min(...fire);
    for (let i = 0; i < n; i++) fire[i] -= zero;
  } else if (spec.crank.fireAnglesDeg?.length === n) {
    spec.crank.fireAnglesDeg.forEach((a, i) => { fire[i] = mod(a - spec.crank.fireAnglesDeg![0], 360); });
    honoured = true;
  } else {
    const order = validOrder(spec.firingOrder, n) ? spec.firingOrder : Array.from({ length: n }, (_, i) => i + 1);
    honoured = validOrder(spec.firingOrder, n);
    order.forEach((cyl, k) => { fire[cyl - 1] = (k * 360) / n; });
  }
  const cylinders: CylinderGeometry[] = Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    bank: bankOf(i + 1),
    throwIndex: throwOf(i + 1),
    positionM: throwOf(i + 1) * pitch,
    bankAxisDeg: bankAxesDeg[bankOf(i + 1)],
    pinAngleDeg: mod(fire[i] + bankAxesDeg[bankOf(i + 1)], 360),
    fireAngleDeg: fire[i],
  }));
  const sorted = cylinders.slice().sort((a, b) => a.fireAngleDeg - b.fireAngleDeg);
  const angles = sorted.map((c) => c.fireAngleDeg);
  const intervals = n === 1 ? [360] : angles.map((a, i) => (i + 1 < angles.length ? angles[i + 1] - a : 360 - a + angles[0]));
  const notes: string[] = [];
  if (intervals.some((d) => Math.abs(d - 360 / n) > 0.5)) notes.push(`Uneven firing: ${intervals.map((d) => Math.round(d)).join("/")}°.`);
  return { cylinders, firingOrder: sorted.map((c) => c.number), intervalsDeg: intervals, bankCount: bankAxesDeg.length, bankAxesDeg, requestedOrderHonoured: honoured, notes };
}

/**
 * Wankel: chambers numbered rotor by rotor (faces 1–3 on rotor 1, 4–6 on rotor 2, …). A rotor's
 * faces fire 360° of e-shaft apart; rotors are phased 360/rotors apart, so a two-rotor fires every
 * 180° (twice per revolution, like a four-cylinder four-stroke).
 */
function rotarySchedule(spec: Pick<EngineSpec, "borePitchMm">, n: number): FiringSchedule {
  const rotors = Math.max(1, Math.round(n / 3));
  const pitch = (spec.borePitchMm || 100) / 1000;
  const cylinders: CylinderGeometry[] = Array.from({ length: n }, (_, i) => {
    const rotor = Math.floor(i / 3);
    const face = i % 3;
    return {
      number: i + 1,
      bank: rotor,
      throwIndex: rotor,
      positionM: rotor * pitch,
      bankAxisDeg: 0,
      pinAngleDeg: mod(rotor * (360 / rotors), 360),
      fireAngleDeg: mod(face * 360 + rotor * (360 / rotors), 1080),
    };
  });
  const sorted = cylinders.slice().sort((a, b) => a.fireAngleDeg - b.fireAngleDeg);
  const angles = sorted.map((c) => c.fireAngleDeg);
  const intervals = angles.map((a, i) => (i + 1 < angles.length ? angles[i + 1] - a : 1080 - a + angles[0]));
  return { cylinders, firingOrder: sorted.map((c) => c.number), intervalsDeg: intervals, bankCount: rotors, bankAxesDeg: new Array(rotors).fill(0), requestedOrderHonoured: true, notes: [], groupByBank: true };
}

function validOrder(order: number[] | undefined, n: number): order is number[] {
  if (!order || order.length !== n) return false;
  const seen = new Set(order);
  return seen.size === n && order.every((c) => Number.isInteger(c) && c >= 1 && c <= n);
}

/** Even-fire order for engines without a table entry: alternate ends of the crank, then banks. */
function evenDefaultOrder(n: number, throwOf: (cyl: number) => number): number[] {
  const cyls = Array.from({ length: n }, (_, i) => i + 1);
  const order: number[] = [];
  const remaining = new Set(cyls);
  let current = 1;
  while (order.length < n) {
    order.push(current);
    remaining.delete(current);
    if (!remaining.size) break;
    const lastThrow = throwOf(current);
    // pick the remaining cylinder furthest along the crank from the last one (spreads bearing load)
    let best = -1;
    let bestScore = -Infinity;
    for (const c of remaining) {
      const score = Math.abs(throwOf(c) - lastThrow) * 10 + (c % 2 !== current % 2 ? 3 : 0) - c * 1e-3;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    current = best;
  }
  return order;
}

export interface ExhaustGroup {
  /** 1-based cylinder numbers merging in this collector. */
  cylinders: number[];
  bank: number;
  /** Optional intermediate pairing (4-2-1): sub-groups merging first. */
  pairs?: number[][];
}

/** Which cylinders share a collector. */
export function exhaustGroups(schedule: FiringSchedule, strategy: CollectorStrategy): ExhaustGroup[] {
  const cyls = schedule.cylinders;
  const byBank = (bank: number) => cyls.filter((c) => c.bank === bank).map((c) => c.number);
  switch (strategy) {
    case "none":
      return cyls.map((c) => ({ cylinders: [c.number], bank: c.bank }));
    case "all":
      return [{ cylinders: cyls.map((c) => c.number), bank: 0 }];
    case "firing-alternate": {
      const groups = schedule.bankCount >= 2 && cyls.length >= 6 ? 2 : cyls.length >= 4 ? 2 : 1;
      return Array.from({ length: groups }, (_, g) => ({
        cylinders: schedule.firingOrder.filter((_, k) => k % groups === g),
        bank: g,
      }));
    }
    case "pairs-then-bank": {
      return bankGroups().map((group) => {
        const ordered = schedule.firingOrder.filter((c) => group.cylinders.includes(c));
        const half = Math.ceil(ordered.length / 2);
        const pairs: number[][] = [];
        for (let k = 0; k < half; k++) {
          const pair = [ordered[k], ordered[k + half]].filter((c): c is number => c !== undefined);
          pairs.push(pair);
        }
        return { ...group, pairs };
      });
    }
    case "bank":
    default:
      return bankGroups();
  }

  function bankGroups(): ExhaustGroup[] {
    if (schedule.groupByBank) return Array.from({ length: schedule.bankCount }, (_, bank) => ({ cylinders: byBank(bank), bank }));
    if (schedule.bankCount === 1 || schedule.cylinders.length < 3) {
      const all = cyls.map((c) => c.number);
      // Long inline engines conventionally split front/rear (e.g. 3-into-1 ×2 on an I6).
      if (all.length >= 6) {
        const half = Math.ceil(all.length / 2);
        return [{ cylinders: all.slice(0, half), bank: 0 }, { cylinders: all.slice(half), bank: 1 }];
      }
      return [{ cylinders: all, bank: 0 }];
    }
    if (schedule.bankCount > 2) {
      // W / X / radial: banks leaning left and banks leaning right collect on their own side.
      const left: number[] = [];
      const right: number[] = [];
      for (const c of cyls) (Math.sin((schedule.bankAxesDeg[c.bank] * Math.PI) / 180) < -1e-9 ? left : right).push(c.number);
      const sides = [{ cylinders: left, bank: 0 }, { cylinders: right, bank: 1 }].filter((g) => g.cylinders.length);
      if (!schedule.moduleOffsetsDeg) return sides;
      // Cross-Four with several modules: each bank (upper, lower) merges first, then the two join on its side.
      return sides.map((g) => {
        const banks = new Map<number, number[]>();
        for (const c of g.cylinders) banks.set(cyls[c - 1].bank, [...(banks.get(cyls[c - 1].bank) ?? []), c]);
        const pairs = [...banks.values()];
        return pairs.length > 1 && pairs[0].length > 1 ? { ...g, pairs } : g;
      });
    }
    return [0, 1].map((bank) => ({ cylinders: byBank(bank), bank })).filter((g) => g.cylinders.length);
  }
}
