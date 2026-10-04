import { afterEach, describe, expect, it } from "vitest";
import { EngineSimulator } from "./engine";
import { resolveEngineSpec } from "./resolveSpec";
import { solveFiringSchedule } from "./geometry";
import { cycleDegrees } from "./spec";
import { REFERENCE_ENGINES } from "./reference/engines";
import type { EngineConfiguration } from "../engineTypes";
import { runConfig } from "./fuzz";

const FS = 48000;

// These tests are long synchronous simulations; yield a macrotask between them so the worker can
// answer the runner's RPC (otherwise a file running > 60 s trips vitest's onTaskUpdate timeout).
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

function specOf(key: string, patch: (c: EngineConfiguration) => EngineConfiguration = (c) => c) {
  return resolveEngineSpec(patch({ ...REFERENCE_ENGINES[key].config, seed: 1 }));
}

function dyno(key: string, rpm: number, seconds = 2.5, patch?: (c: EngineConfiguration) => EngineConfiguration) {
  const sim = new EngineSimulator(specOf(key, patch), FS);
  sim.setControls({ mode: "dyno", targetRpm: rpm, throttle: 1 });
  sim.prewarm(seconds);
  return sim;
}

describe("firing schedules", () => {
  const cases: Array<[string, number[]]> = [
    ["gm-ls3", [90]],
    ["ferrari-f140", [60]],
    ["porsche-9a1", [120]],
    ["audi-ea855", [144]],
    ["bugatti-w16", [45]],
    ["yamaha-cp3", [240]],
  ];
  for (const [key, expected] of cases) {
    it(`${key} fires evenly at ${expected[0]}°`, () => {
      const s = solveFiringSchedule(specOf(key));
      for (const d of s.intervalsDeg) expect(d).toBeCloseTo(expected[0], 3);
    });
  }

  it("odd-fire and cross-plane-four engines keep their uneven intervals", () => {
    expect(solveFiringSchedule(specOf("harley-m8-107")).intervalsDeg.map(Math.round)).toEqual([315, 405]);
    expect(solveFiringSchedule(specOf("ducati-1299")).intervalsDeg.map(Math.round)).toEqual([270, 450]);
    expect(solveFiringSchedule(specOf("yamaha-cp4")).intervalsDeg.map(Math.round)).toEqual([90, 180, 270, 180]);
  });

  it("every cycle sums to its cycle length (720° four-stroke, 360° two-stroke)", () => {
    for (const key of Object.keys(REFERENCE_ENGINES)) {
      const spec = specOf(key);
      const sum = solveFiringSchedule(spec).intervalsDeg.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(cycleDegrees(spec), 3);
    }
  });
});

describe("reference engines against published figures", () => {
  // Brake output on the simulated dyno must land within ±12 % of the manufacturer's figure.
  const points: Array<[string, "torque" | "power"]> = [
    ["gm-ls3", "torque"],
    ["porsche-9a1", "power"],
    ["ferrari-f140", "power"],
    ["vw-ea288", "torque"],
    ["vw-ea288", "power"],
    ["cummins-6bt", "torque"],
    ["cummins-6bt", "power"],
    ["yamaha-rd350lc", "torque"],
    ["yamaha-rd350lc", "power"],
  ];
  for (const [key, kind] of points) {
    it(`${key} peak ${kind}`, () => {
      const ref = REFERENCE_ENGINES[key];
      const [value, rpm] = (kind === "torque" ? ref.published?.peakTorqueNm : ref.published?.peakPowerKw)!;
      const t = dyno(key, rpm).telemetry;
      const measured = kind === "torque" ? t.brakeTorqueNm : t.powerKw;
      expect(Math.abs(measured / value - 1)).toBeLessThan(0.12);
    });
  }
});

describe("combustion", () => {
  it("phases peak pressure in the MBT window at NA WOT", () => {
    const t = dyno("gm-ls3", 4600).telemetry;
    expect(t.peakPressureAngle).toBeGreaterThan(10);
    expect(t.peakPressureAngle).toBeLessThan(20);
    expect(t.knockRetardDeg).toBeLessThan(3);
  });

  it("knock control retards spark as octane falls", () => {
    const premium = dyno("gm-ls3", 1500, 2.5).telemetry.knockRetardDeg;
    const regular = dyno("gm-ls3", 1500, 2.5, (c) => ({ ...c, physical: { ...c.physical, fuelOctane: 87 } })).telemetry.knockRetardDeg;
    expect(regular).toBeGreaterThan(premium + 3);
  });

  it("without knock control a low-octane engine knocks audibly", () => {
    const sim = dyno("gm-ls3", 1500, 1.5, (c) => ({ ...c, physical: { ...c.physical, fuelOctane: 85, knockControl: false } }));
    expect(sim.telemetry.knockEvents).toBeGreaterThan(5);
  });
});

describe("diesel combustion", () => {
  function idleStructure(pilot: boolean) {
    const sim = new EngineSimulator(specOf("vw-ea288", (c) => ({ ...c, physical: { ...c.physical, pilotInjection: pilot } })), FS);
    sim.setControls({ mode: "free", throttle: 0 });
    sim.prewarm(2);
    Object.assign(sim.stems, { exhaust: 0, exhaustJet: 0, valveJet: 0, intake: 0, structure: 1, accessory: 0 });
    const n = FS;
    const l = new Float32Array(n);
    sim.process(l, new Float32Array(n), n);
    // 1–4 kHz band energy (combustion noise region).
    let a = 0;
    let b = 0;
    let e = 0;
    const ka = 1 - Math.exp((-2 * Math.PI * 4000) / FS);
    const kb = 1 - Math.exp((-2 * Math.PI * 1000) / FS);
    for (const v of l) {
      a += (v - a) * ka;
      b += (v - b) * kb;
      e += (a - b) * (a - b);
    }
    const cyl = (sim as unknown as { cylinders: Array<{ lastIgnitionDelayDeg: number }> }).cylinders[0];
    return { db: 10 * Math.log10(e / n), delay: cyl.lastIgnitionDelayDeg, rpm: sim.rpm };
  }

  it("idles on its governor, with Hardenberg–Hase ignition delay and pilot injection softening the clatter", () => {
    const plain = idleStructure(false);
    const pilot = idleStructure(true);
    expect(plain.rpm).toBeGreaterThan(650);
    expect(plain.rpm).toBeLessThan(900);
    // Idle ignition delay of a DI diesel ≈ 0.5–1.5 ms ≈ 2–8 °CA at 760 rpm.
    expect(plain.delay).toBeGreaterThan(2);
    expect(plain.delay).toBeLessThan(8);
    expect(pilot.delay).toBeLessThan(plain.delay);
    // Pilot injection lowers combustion noise by ≈ 3–10 dB.
    expect(plain.db - pilot.db).toBeGreaterThan(3);
  }, 60_000);
});

describe("two-stroke", () => {
  it("fires every revolution: a parallel twin at 180°", () => {
    expect(solveFiringSchedule(specOf("yamaha-rd350lc")).intervalsDeg.map(Math.round)).toEqual([180, 180]);
  });

  it("the tuned expansion chamber lifts output near its tuned speed", () => {
    const tuned = dyno("yamaha-rd350lc", 8000, 2).telemetry.powerKw;
    const plain = dyno("yamaha-rd350lc", 8000, 2, (c) => ({ ...c, physical: { ...c.physical, expansionChamber: false } })).telemetry.powerKw;
    // Blair: a tuned pipe adds tens of percent at its tuned speed over a plain exhaust.
    expect(tuned / plain).toBeGreaterThan(1.2);
  }, 60_000);
});

describe("valve timing", () => {
  it("phasers sit at minimum overlap at idle and advance the intake at low-speed full load", () => {
    const idle = new EngineSimulator(specOf("bmw-s54"), FS);
    idle.setControls({ mode: "free", throttle: 0 });
    idle.prewarm(1.5);
    expect(idle.telemetry.intakeCamAdvanceDeg).toBeLessThan(1);
    const wot = dyno("bmw-s54", 2500, 1.5).telemetry;
    expect(wot.intakeCamAdvanceDeg).toBeGreaterThan(40);
  });

  it("VTEC engages above its switch speed at full load and stays off at cruise", () => {
    expect(dyno("honda-k20a", 7000, 1.5).telemetry.highCam).toBe(true);
    expect(dyno("honda-k20a", 4500, 1.5).telemetry.highCam).toBe(false);
  });
});

describe("vehicle and start/stop", () => {
  it("an LS3 car reaches 100 km/h in a realistic time with automated shifts", () => {
    const sim = new EngineSimulator(specOf("gm-ls3"), FS);
    sim.setControls({ mode: "vehicle", throttle: 0, autoShift: true });
    sim.prewarm(1.5);
    sim.setControls({ throttle: 1 });
    let t = 0;
    while (sim.telemetry.speedKmh < 100 && t < 10) {
      sim.prewarm(0.1);
      t += 0.1;
    }
    // Published 0–100 km/h for LS3 cars ≈ 4.6–4.9 s.
    expect(t).toBeGreaterThan(4.0);
    expect(t).toBeLessThan(6.0);
    expect(sim.telemetry.gear).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("a stopped engine cranks, catches and returns to idle", () => {
    const spec = specOf("honda-k20a");
    const sim = new EngineSimulator(spec, FS);
    sim.setControls({ mode: "free", throttle: 0 });
    sim.prewarm(1);
    sim.stopEngine();
    sim.prewarm(1);
    expect(sim.rpm).toBeLessThan(5);
    sim.start();
    sim.prewarm(4);
    expect(sim.telemetry.engineState).toBe("running");
    expect(sim.rpm).toBeGreaterThan(spec.calibration.idleRpm * 0.7);
    expect(sim.rpm).toBeLessThan(spec.calibration.idleRpm * 1.6);
  }, 60_000);
});

describe("forced induction", () => {
  /** Lift off from full boost at a held 5000 rpm; returns the compressor mass-flow trace (1 kHz). */
  function liftOff(bov: boolean): number[] {
    const sim = dyno("toyota-2jz-gte", 5000, 3, (c) => ({ ...c, forcedInduction: { ...c.forcedInduction, bovEnabled: bov } }));
    sim.setControls({ throttle: 0 });
    const compressor = (sim as unknown as { fi: { compressor: { massFlow: number } } }).fi.compressor;
    const flow: number[] = [];
    for (let i = 0; i < 1500; i++) {
      sim.prewarm(0.001);
      flow.push(compressor.massFlow);
    }
    return flow;
  }

  it("without a blow-off valve the compressor deep-surges at a flutter rate after lift-off", () => {
    const flow = liftOff(false);
    let reversals = 0;
    let forward = true;
    for (const f of flow) {
      if (forward && f < -0.01) {
        forward = false;
        reversals++;
      } else if (!forward && f > 0.03) forward = true;
    }
    // 10–35 Hz over 1.5 s (Dehner & Selamet: deep surge just below the charge-system Helmholtz frequency).
    expect(reversals).toBeGreaterThan(15);
    expect(reversals).toBeLessThan(55);
  }, 30_000);

  it("a blow-off valve keeps the compressor out of surge", () => {
    expect(Math.min(...liftOff(true))).toBeGreaterThan(0);
  }, 30_000);

  it("parallel turbos share the airflow (quad-turbo W16 builds boost)", () => {
    const t = dyno("bugatti-w16", 4000, 3).telemetry;
    expect(t.mapKpa).toBeGreaterThan(160);
  });
});

describe("numerical health", () => {
  for (const key of Object.keys(REFERENCE_ENGINES)) {
    it(`${key} idles with finite output near its target`, () => {
      const out = new Float32Array(4800);
      const outR = new Float32Array(4800);
      const spec = specOf(key);
      const sim = new EngineSimulator(spec, FS);
      sim.setControls({ mode: "free", throttle: 0 });
      sim.prewarm(2);
      sim.process(out, outR, out.length);
      for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
      expect(sim.rpm).toBeGreaterThan(spec.calibration.idleRpm * 0.4);
      expect(sim.rpm).toBeLessThan(spec.calibration.idleRpm * 1.8);
    }, 30_000);
  }
});

describe("random configurations", () => {
  // A few seeds from the robustness sweep (scripts/fuzzConfigs.ts runs the full set): seed 34 as the
  // 10 L turbo inline-8 that once overran its soft limiter (its gasoline draw), seed 29 a diesel.
  const cases: Array<[number, boolean]> = [[3, true], [17, true], [34, false], [29, true]];
  for (const [seed, diesel] of cases) {
    it(`seed ${seed}${diesel ? "" : " (gasoline)"} idles, holds the dyno and respects its limiter`, () => {
      const r = runConfig(seed, FS, { diesel, twoStroke: false });
      expect(r.problems).toEqual([]);
    }, 120_000);
  }
});
