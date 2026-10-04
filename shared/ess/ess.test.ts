import { describe, expect, it } from "vitest";
import { EngineSimulator } from "./engine";
import { resolveEngineSpec } from "./resolveSpec";
import { solveFiringSchedule } from "./geometry";
import { REFERENCE_ENGINES } from "./reference/engines";
import type { EngineConfiguration } from "../engineTypes";

const FS = 48000;

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

  it("every cycle sums to 720°", () => {
    for (const key of Object.keys(REFERENCE_ENGINES)) {
      const sum = solveFiringSchedule(specOf(key)).intervalsDeg.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(720, 3);
    }
  });
});

describe("reference engines against published figures", () => {
  // Brake output on the simulated dyno must land within ±12 % of the manufacturer's figure.
  const points: Array<[string, "torque" | "power"]> = [
    ["gm-ls3", "torque"],
    ["porsche-9a1", "power"],
    ["ferrari-f140", "power"],
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

describe("forced induction", () => {
  it("parallel turbos share the airflow (quad-turbo W16 builds boost)", () => {
    const t = dyno("bugatti-w16", 4000, 3).telemetry;
    expect(t.mapKpa).toBeGreaterThan(160);
  });
});

describe("numerical health", () => {
  it("every reference engine idles with finite output near its target", () => {
    const out = new Float32Array(4800);
    const outR = new Float32Array(4800);
    for (const key of Object.keys(REFERENCE_ENGINES)) {
      const spec = specOf(key);
      const sim = new EngineSimulator(spec, FS);
      sim.setControls({ mode: "free", throttle: 0 });
      sim.prewarm(2);
      sim.process(out, outR, out.length);
      for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
      expect(sim.rpm).toBeGreaterThan(spec.calibration.idleRpm * 0.4);
      expect(sim.rpm).toBeLessThan(spec.calibration.idleRpm * 1.8);
    }
  }, 120_000);
});
