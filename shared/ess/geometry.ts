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
import type { CrankSpec, EngineSpec, EssCrankType, EssLayout, CollectorStrategy } from "./spec";

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
}

const mod = (x: number, m: number) => ((x % m) + m) % m;

export function bankLayout(layout: EssLayout, cylinders: number, bankAngleDeg: number, vrAngleDeg: number): {
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
  if (layout === "radial") {
    const axes = Array.from({ length: n }, (_, k) => (k * 360) / n);
    return { bankAxesDeg: axes, bankOf: (c) => c - 1, throwOf: () => 0 };
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
 */
function realiseOrder(order: number[], c: number[]): number[] | null {
  const n = c.length;
  if (order.length !== n) return null;
  const first = order[0] - 1;
  let best: number[] | null = null;
  let bestCost = Infinity;
  const fire = new Array<number>(n);
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    let bit = 0;
    for (let i = 0; i < n; i++) {
      if (i === first) { fire[i] = 0; continue; }
      fire[i] = mod(c[i] - c[first] + ((mask >> bit++) & 1 ? 360 : 0), 720);
    }
    let ok = true;
    for (let k = 1; k < n && ok; k++) ok = fire[order[k] - 1] > fire[order[k - 1] - 1] + 1e-6;
    if (!ok) continue;
    const cost = unevenness(fire);
    if (cost < bestCost - 1e-9) { bestCost = cost; best = fire.slice(); }
  }
  return best;
}

function optimalSchedule(c: number[], throwOf: (cyl: number) => number): number[] {
  const n = c.length;
  if (n === 1) return [0];
  let best: number[] = [];
  let bestCost = Infinity;
  const combos = 1 << (n - 1);
  const fire = new Array<number>(n);
  for (let mask = 0; mask < combos; mask++) {
    fire[0] = 0;
    for (let i = 1; i < n; i++) {
      fire[i] = mod(c[i] - c[0] + ((mask >> (i - 1)) & 1 ? 360 : 0), 720);
    }
    let cost = unevenness(fire);
    if (cost > bestCost + 1e-6) continue;
    // Tie-break: avoid consecutive firing of adjacent throws (bearing load; how real orders are chosen).
    const order = fire.map((a, i) => [a, i] as const).sort((a, b) => a[0] - b[0]).map((t) => t[1]);
    let adjacency = 0;
    for (let k = 0; k < n; k++) {
      const a = order[k];
      const b = order[(k + 1) % n];
      if (Math.abs(throwOf(a + 1) - throwOf(b + 1)) === 1) adjacency++;
    }
    cost += adjacency * 1e-3;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = fire.slice();
    }
  }
  return best;
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

export function solveFiringSchedule(spec: Pick<EngineSpec, "layout" | "cylinders" | "bankAngleDeg" | "vrAngleDeg" | "crank" | "firingOrder" | "borePitchMm">): FiringSchedule {
  const n = Math.max(1, Math.floor(spec.cylinders));
  const notes: string[] = [];
  const { bankAxesDeg, bankOf, throwOf } = bankLayout(spec.layout, n, spec.bankAngleDeg, spec.vrAngleDeg);
  const crank: CrankSpec = spec.crank;
  const throwCount = Math.max(...Array.from({ length: n }, (_, i) => throwOf(i + 1))) + 1;
  const pitch = (spec.borePitchMm || 100) / 1000;

  let pins: number[];
  let fire: number[] | null = null;
  let honoured = false;

  if (crank.type === "custom" && crank.fireAnglesDeg?.length === n) {
    fire = crank.fireAnglesDeg.map((a) => mod(a - crank.fireAnglesDeg![0], 720));
    pins = Array.from({ length: n }, (_, i) => mod(fire![i] + bankAxesDeg[bankOf(i + 1)], 360));
    honoured = true;
  } else if (crank.type === "even-fire") {
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
    pins = Array.from({ length: n }, (_, i) => crank.type === "custom" && crank.pinAnglesDeg?.length === n
      ? crank.pinAnglesDeg[i]
      : throwTable![throwOf(i + 1)] ?? 0);
    const c = pins.map((p, i) => mod(p - bankAxesDeg[bankOf(i + 1)], 360));
    const optimal = optimalSchedule(c, throwOf);
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
  const order = cylindersGeom.slice().sort((a, b) => a.fireAngleDeg - b.fireAngleDeg);
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
  };
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
      // W / radial: pair adjacent banks onto two sides of the vehicle.
      const left: number[] = [];
      const right: number[] = [];
      for (const c of cyls) (schedule.bankAxesDeg[c.bank] < 0 ? left : right).push(c.number);
      return [{ cylinders: left, bank: 0 }, { cylinders: right, bank: 1 }].filter((g) => g.cylinders.length);
    }
    return [0, 1].map((bank) => ({ cylinders: byBank(bank), bank })).filter((g) => g.cylinders.length);
  }
}
