import { describe, expect, it } from "vitest";
import { optimalSchedule, realiseOrder, solveFiringSchedule, xEvenFiringOffsets, xLowCoupleOffsets, xPulseGaps, xRockingCouple } from "./geometry";
import { resolveEngineSpec } from "./resolveSpec";
import type { EngineConfiguration } from "../engineTypes";

const mod = (x: number, m: number) => ((x % m) + m) % m;

function unevenness(fire: number[]): number {
  const sorted = fire.slice().sort((a, b) => a - b);
  const ideal = 720 / fire.length;
  return sorted.reduce((cost, a, i) => cost + ((i + 1 < sorted.length ? sorted[i + 1] - a : 720 - a + sorted[0]) - ideal) ** 2, 0);
}

/** The exhaustive search the solver replaced: every choice of firing revolution, lowest mask on ties. */
function bruteOptimal(c: number[], throwOf: (cyl: number) => number, radial: boolean): number[] {
  const n = c.length;
  let best: number[] = [];
  let bestCost = Infinity;
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    const fire = c.map((x, i) => (i === 0 ? 0 : mod(x - c[0] + ((mask >> (i - 1)) & 1 ? 360 : 0), 720)));
    const order = fire.map((a, i) => [a, i] as const).sort((a, b) => a[0] - b[0]).map((t) => t[1]);
    let adjacency = 0;
    for (let k = 0; k < n; k++) {
      const ta = throwOf(order[k] + 1);
      const tb = throwOf(order[(k + 1) % n] + 1);
      if (radial ? ta === tb : Math.abs(ta - tb) === 1) adjacency++;
    }
    const cost = unevenness(fire) + adjacency * 1e-3;
    if (cost < bestCost - 1e-9) { bestCost = cost; best = fire; }
  }
  return best;
}

function bruteOrder(order: number[], c: number[]): number[] | null {
  const n = c.length;
  const first = order[0] - 1;
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    let bit = 0;
    const fire = c.map((x, i) => (i === first ? 0 : mod(x - c[first] + ((mask >> bit++) & 1 ? 360 : 0), 720)));
    let ok = true;
    for (let k = 1; k < n && ok; k++) ok = fire[order[k] - 1] > fire[order[k - 1] - 1] + 1e-6;
    if (!ok) continue;
    const cost = unevenness(fire);
    if (cost < bestCost - 1e-9) { bestCost = cost; best = fire; }
  }
  return best;
}

describe("firing-schedule solver", () => {
  // Deterministic pseudo-random TDC sets on a 15° grid (coincident TDCs included, as real cranks have).
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  it("finds the same schedule as an exhaustive search", () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(rnd() * 9);
      const c = Array.from({ length: n }, () => Math.floor(rnd() * 24) * 15);
      const throwsPer = 1 + Math.floor(rnd() * 3);
      const throwOf = (cyl: number) => Math.floor((cyl - 1) / throwsPer);
      const radial = rnd() < 0.3;
      expect(optimalSchedule(c, throwOf, radial), `c = ${c.join(",")}`).toEqual(bruteOptimal(c, throwOf, radial));
    }
  });

  it("realises a requested order exactly as an exhaustive search does", () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(rnd() * 8);
      const c = Array.from({ length: n }, () => Math.floor(rnd() * 24) * 15);
      const order = Array.from({ length: n }, (_, i) => i + 1).sort(() => rnd() - 0.5);
      expect(realiseOrder(order, c), `order ${order.join("-")} c = ${c.join(",")}`).toEqual(bruteOrder(order, c));
    }
  });

  it("solves 24 and 36 cylinders in well under a second", () => {
    const t0 = performance.now();
    const x24 = solveFiringSchedule({ layout: "x", cylinders: 24, bankAngleDeg: 0, vrAngleDeg: 15, crank: { type: "even-fire" }, firingOrder: [], borePitchMm: 46, x: { tiltDeg: 15, phasing: "even-firing", planePitchMm: 46 } });
    const r36 = solveFiringSchedule({ layout: "radial", cylinders: 36, bankAngleDeg: 0, vrAngleDeg: 15, crank: { type: "single-pin" }, firingOrder: [], borePitchMm: 100 });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(x24.intervalsDeg.reduce((a, b) => a + b, 0)).toBeCloseTo(720, 6);
    expect(new Set(r36.firingOrder).size).toBe(36);
  });
});

describe("Cross-Four X layout", () => {
  const schedule = (cylinders: number, tiltDeg: number, extra: Record<string, unknown> = {}) =>
    solveFiringSchedule({ layout: "x", cylinders, bankAngleDeg: 2 * tiltDeg, vrAngleDeg: 15, crank: { type: "even-fire" }, firingOrder: [], borePitchMm: 46, strokeMm: 190, rodLengthMm: 400, x: { tiltDeg, phasing: "even-firing", planePitchMm: 46 }, ...extra });

  it("fires the two opposed pairs of a module 90° + 2t apart", () => {
    for (const t of [0, 10.5, 15, 30, 45]) {
      const s = schedule(4, t);
      const a = Math.min(90 + 2 * t, 270 - 2 * t);
      expect(s.intervalsDeg.map((d) => +d.toFixed(6)).sort((x, y) => x - y)).toEqual([a, a, 360 - a, 360 - a].map((d) => +d.toFixed(6)).sort((x, y) => x - y));
      // Opposed cylinders (1 and 3, 2 and 4) reach TDC together, so they fire one revolution apart.
      const fire = s.cylinders.map((c) => c.fireAngleDeg);
      expect(mod(fire[2] - fire[0], 720)).toBeCloseTo(360, 6);
      expect(mod(fire[3] - fire[1], 720)).toBeCloseTo(360, 6);
    }
  });

  it("clocks the modules as the Saber study does", () => {
    expect(xEvenFiringOffsets(1, 15)).toEqual([0]);
    expect(xEvenFiringOffsets(2, 15)).toEqual([0, 180]);
    expect(xEvenFiringOffsets(3, 15)).toEqual([0, 160, 80]);
    expect(xEvenFiringOffsets(4, 15)).toEqual([0, 90, 180, 270]);
    expect(xPulseGaps([0, 180], 15)).toEqual([120, 60, 120, 60]);
    // A square X (45° tilt) of four modules fires all sixteen cylinders 45° apart.
    for (const d of schedule(16, 45).intervalsDeg) expect(d).toBeCloseTo(45, 6);
    // Three modules can cancel the rocking couple almost entirely; even firing leaves a large one.
    const low = xLowCoupleOffsets(3, 15, 95, 400);
    expect(low).toEqual([0, 120, 240]);
    expect(xRockingCouple(low, 15, 95, 400, 46)).toBeLessThan(0.001 * xRockingCouple(xEvenFiringOffsets(3, 15), 15, 95, 400, 46));
  });

  it("gives every cylinder its own throw in the 1·3·2·4 plane order, and sides for the exhaust", () => {
    const s = schedule(8, 15);
    expect(s.cylinders.map((c) => c.throwIndex)).toEqual([0, 2, 1, 3, 4, 6, 5, 7]);
    expect(s.cylinders.map((c) => +(c.positionM * 1000).toFixed(1))).toEqual([0, 92, 46, 138, 184, 276, 230, 322]);
    expect(s.bankCount).toBe(4);
    // Cylinders 1 and 2 share a side; 3 and 4 the other.
    const side = (cyl: number) => Math.sign(Math.sin((s.cylinders[cyl - 1].bankAxisDeg * Math.PI) / 180));
    expect(side(1)).toBe(side(2));
    expect(side(3)).toBe(side(4));
    expect(side(1)).toBe(-side(3));
  });

  it("resolves the study's proportions from displacement and module count", () => {
    const config: EngineConfiguration = { quick: { layout: "x", cylinderCount: 8, displacement: 11.0, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 3000 }, forcedInduction: { type: "na" } };
    const spec = resolveEngineSpec(config);
    expect(spec.cylinders).toBe(8);
    expect(spec.boreMm).toBeCloseTo(96, 0);
    expect(spec.strokeMm).toBeCloseTo(190, 0);
    expect(spec.rodLengthMm).toBeCloseTo(400, 0);
    expect(spec.x).toMatchObject({ tiltDeg: 15, phasing: "even-firing" });
    expect(solveFiringSchedule(spec).moduleOffsetsDeg).toEqual([0, 180]);
    // A cylinder count that is not a whole number of modules rounds to one.
    expect(resolveEngineSpec({ ...config, quick: { ...config.quick, cylinderCount: 10 } }).cylinders).toBe(12);
  });

  it("two-strokes fire each opposed pair together", () => {
    const s = schedule(4, 15, { cycle: "two-stroke" });
    expect(s.intervalsDeg.reduce((a, b) => a + b, 0)).toBeCloseTo(360, 6);
    expect(s.cylinders[0].fireAngleDeg).toBeCloseTo(s.cylinders[2].fireAngleDeg, 6);
    expect(s.cylinders[1].fireAngleDeg).toBeCloseTo(s.cylinders[3].fireAngleDeg, 6);
  });
});
