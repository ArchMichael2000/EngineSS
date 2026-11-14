import { afterEach, describe, expect, it } from "vitest";
import { EngineSimulator } from "./engine";
import { resolveEngineSpec } from "./resolveSpec";
import { solveFiringSchedule } from "./geometry";
import { cycleDegrees } from "./spec";
import { REFERENCE_ENGINES } from "./reference/engines";
import { DEFAULT_ENGINE_CONFIG, FACTORY_PRESETS, SABER_PRESETS } from "../engineTypes";
import type { EngineConfiguration } from "../engineTypes";
import { runConfig } from "./fuzz";
import { Observer } from "./observer";

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

  it("radials fire evenly at every cylinder count; even counts are staggered rows", () => {
    for (const n of [3, 5, 7, 8, 9, 10, 12, 14, 18]) {
      // Plain rods: the idealised crank, exactly even. (Master-and-link rods are tested below.)
      const spec = specOf("pw-r985", (c) => ({ ...c, quick: { ...c.quick, cylinderCount: n }, physical: { ...c.physical, articulatedRods: false } }));
      const s = solveFiringSchedule(spec);
      for (const d of s.intervalsDeg) expect(d).toBeCloseTo(720 / n, 3);
      if (n % 2 === 0 && (n / 2) % 2 === 1) {
        // Rows of an odd count (2 × 5, 2 × 7, 2 × 9) alternate every event, as real two-row radials do.
        const row = (cyl: number) => s.cylinders[cyl - 1].throwIndex;
        for (let k = 0; k < n; k++) expect(row(s.firingOrder[k])).not.toBe(row(s.firingOrder[(k + 1) % n]));
      }
    }
  });

  it("a nine-cylinder radial fires 1-3-5-7-9-2-4-6-8, and its link rods make the intervals uneven", () => {
    const s = solveFiringSchedule(specOf("pw-r985"));
    expect(s.firingOrder).toEqual([1, 3, 5, 7, 9, 2, 4, 6, 8]);
    expect(s.linkRows).toHaveLength(1);
    // The master cylinder keeps its plain-rod TDC; link cylinders are up to about 4° off.
    const offsets = s.cylinders.map((c) => c.motion!.tdcOffsetDeg);
    expect(offsets[0]).toBeCloseTo(0, 6);
    expect(Math.max(...offsets.map(Math.abs))).toBeGreaterThan(2.5);
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThan(5);
    // Opposite sides of the master rod are mirror images.
    for (let k = 1; k < 9; k++) expect(offsets[k]).toBeCloseTo(-offsets[9 - k], 3);
    expect(s.intervalsDeg.reduce((a, b) => a + b, 0)).toBeCloseTo(720, 6);
    expect(Math.max(...s.intervalsDeg) - Math.min(...s.intervalsDeg)).toBeGreaterThan(5);
    // Strokes differ by well under a percent, and every piston returns to TDC (zero displacement) once a revolution.
    for (const c of s.cylinders) {
      expect(c.motion!.stroke / 131.8).toBeGreaterThan(0.999);
      expect(c.motion!.stroke / 131.8).toBeLessThan(1.01);
      expect(Math.min(...c.motion!.displacement)).toBeGreaterThan(-1e-6);
    }
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
    ["mazda-13b-fc", "torque"],
    ["mazda-13b-fc", "power"],
    ["rr-vulture", "power"],
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

describe("rotary", () => {
  it("a two-rotor fires every 180° of e-shaft (three faces per rotor, rotors 180° apart)", () => {
    const s = solveFiringSchedule(specOf("mazda-13b-fc"));
    expect(s.cylinders.length).toBe(6);
    expect(s.intervalsDeg.map(Math.round)).toEqual([180, 180, 180, 180, 180, 180]);
  });

  it("peripheral intake ports trade idle vacuum and dilution for top-end breathing", () => {
    const pp = (c: EngineConfiguration) => ({ ...c, quick: { ...c.quick, idleCharacter: "lopey" as const } });
    const idleStock = new EngineSimulator(specOf("mazda-13b-fc"), FS);
    const idlePP = new EngineSimulator(specOf("mazda-13b-fc", pp), FS);
    for (const s of [idleStock, idlePP]) {
      s.setControls({ mode: "free", throttle: 0 });
      s.prewarm(2);
    }
    // Overlap through the open ports: almost no manifold vacuum at idle.
    expect(idlePP.telemetry.mapKpa).toBeGreaterThan(idleStock.telemetry.mapKpa + 30);
    expect(dyno("mazda-13b-fc", 4000, 2, pp).telemetry.brakeTorqueNm).toBeLessThan(dyno("mazda-13b-fc", 4000, 2).telemetry.brakeTorqueNm);
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

  // Every family drives: a diesel whose neutral limiter sits below its redline (it used to bounce on
  // the limiter in first gear), a two-stroke motorcycle and a rotary car.
  for (const [key, maxSeconds] of [["psa-dv5-bluehdi", 12], ["honda-crm250", 13], ["mazda-13b-fc", 10]] as const) {
    it(`${key} drives away and shifts up to 100 km/h without stalling or riding the limiter`, () => {
      const spec = specOf(key);
      const sim = new EngineSimulator(spec, FS);
      sim.setControls({ mode: "vehicle", throttle: 0, autoShift: true });
      sim.prewarm(1.5);
      sim.setControls({ throttle: 1 });
      let t = 0;
      let limiter = 0;
      let minRpm = Infinity;
      while (sim.telemetry.speedKmh < 100 && t < maxSeconds) {
        sim.prewarm(0.1);
        t += 0.1;
        if (sim.telemetry.limiter) limiter++;
        minRpm = Math.min(minRpm, sim.rpm);
      }
      expect(sim.telemetry.speedKmh).toBeGreaterThanOrEqual(100);
      expect(sim.telemetry.gear).toBeGreaterThanOrEqual(2);
      expect(limiter / (t / 0.1)).toBeLessThan(0.1);
      expect(minRpm).toBeGreaterThan(spec.calibration.idleRpm * 0.4);
    }, 120_000);
  }

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
  // Regression: a dilution misfire limit applied to four-strokes dropped the long-overlap presets
  // (V10, flat-six) to cranking speed every few seconds. Half-second mean speed, eight seconds.
  for (const [key, preset] of Object.entries({ ...FACTORY_PRESETS, ...SABER_PRESETS })) {
    it(`preset ${key} holds its idle without stall cycles`, () => {
      const spec = resolveEngineSpec(preset.config);
      const sim = new EngineSimulator(spec, 32000);
      sim.setControls({ mode: "free", throttle: 0 });
      sim.prewarm(3);
      let lowest = Infinity;
      let highest = 0;
      for (let w = 0; w < 16; w++) {
        let sum = 0;
        for (let k = 0; k < 10; k++) {
          sim.prewarm(0.05);
          sum += sim.rpm;
        }
        lowest = Math.min(lowest, sum / 10);
        highest = Math.max(highest, sum / 10);
      }
      expect(lowest, key).toBeGreaterThan(0.6 * spec.calibration.idleRpm);
      expect(highest, key).toBeLessThan(1.6 * spec.calibration.idleRpm);
    }, 60_000);
  }
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

describe("soft rev limiter", () => {
  // The soft limiter used to cut sparks at random: the engine held its speed on a fifth of its
  // firings, a noise with exhaust bangs in place of a note. It now holds on part throttle.
  for (const key of ["gm-ls3", "ferrari-f136", "nissan-vr38"]) {
    it(`${key} holds its limit on the throttle in a free rev, every cylinder firing`, () => {
      const spec = specOf(key);
      const sim = new EngineSimulator(spec, 24000);
      sim.setControls({ mode: "free", throttle: 0 });
      sim.prewarm(1);
      sim.setControls({ throttle: 1 });
      sim.prewarm(3);
      const inner = sim as unknown as { softCutFraction: number; limiterPlate: number };
      const lim = spec.calibration.revLimiterRpm;
      let lowest = Infinity;
      let highest = 0;
      let cutting = 0;
      let plate = 0;
      const steps = 150;
      for (let k = 0; k < steps; k++) {
        sim.prewarm(0.01);
        lowest = Math.min(lowest, sim.rpm);
        highest = Math.max(highest, sim.rpm);
        if (inner.softCutFraction > 0) cutting++;
        plate += inner.limiterPlate / steps;
      }
      expect(lowest, key).toBeGreaterThan(lim * 0.975);
      expect(highest, key).toBeLessThan(lim * 1.02);
      expect(cutting / steps, key).toBeLessThan(0.15);
      expect(plate, key).toBeLessThan(0.5);
      expect(sim.telemetry.limiter).toBe(true);
    }, 60_000);
  }

  it("learns nothing from blips that touch the limiter and are lifted", () => {
    // Each lift on the limiter used to read as "holding pressure too low" and add 25 kPa of trim,
    // so the next real hold sat in the fuel cut for seconds.
    const sim = new EngineSimulator(resolveEngineSpec({ ...SABER_PRESETS["saber-sb8"].config, seed: 11 }), 24000);
    sim.setControls({ mode: "free", throttle: 0 });
    sim.prewarm(1);
    for (let blip = 0; blip < 3; blip++) {
      sim.setControls({ throttle: 1 });
      sim.prewarm(0.6);
      sim.setControls({ throttle: 0 });
      sim.prewarm(1);
    }
    expect(Math.abs((sim as unknown as { limiterTrim: number }).limiterTrim)).toBeLessThan(8);
  }, 60_000);

  it("lets go of the throttle when a load takes the speed away", () => {
    // A dyno run overshoots its set speed on the way up; 450 rpm under the limit it must be at full throttle.
    const sim = new EngineSimulator(specOf("ferrari-f140"), 24000);
    sim.setControls({ mode: "dyno", targetRpm: 8250, throttle: 1 });
    sim.prewarm(2.5);
    expect((sim as unknown as { limiterPlate: number }).limiterPlate).toBeGreaterThan(0.97);
    expect(sim.telemetry.limiter).toBe(false);
  }, 60_000);
});

describe("valve wave solve", () => {
  it("never steps a valve's outgoing wave near redline on a straight-piped V10", () => {
    // Strong rarefactions arriving at a closing exhaust valve once sent the solver to a spurious
    // root (a full-vacuum wave that ended in one sample): ~170 jumps of > 40 kPa per second here.
    const config = { ...DEFAULT_ENGINE_CONFIG, soundProfile: "v16", seed: 3, quick: { ...DEFAULT_ENGINE_CONFIG.quick, layout: "v", cylinderCount: 10, displacement: 7.0, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "straight-pipe", redline: 8000 } } as EngineConfiguration;
    const sim = new EngineSimulator(resolveEngineSpec(config), FS);
    sim.setControls({ mode: "dyno", targetRpm: 7400, throttle: 1, load: 0.41 });
    sim.prewarm(1);
    // A spurious root shows as a spike: a jump of > 40 kPa taken back within two samples. A jump
    // that stays is a neighbour's blow-down shock reflecting off the closed valve (the send of a
    // closed valve is the arriving wave), which this engine also produces, at 40–42 kPa.
    const cylinders = (sim as unknown as { cylinders: { exhaustSend: number }[] }).cylinders;
    const prev = cylinders.map((c) => c.exhaustSend);
    const jump = cylinders.map(() => ({ size: 0, age: 9 }));
    const l = new Float32Array(1);
    const r = new Float32Array(1);
    let spikes = 0;
    let largest = 0;
    for (let i = 0; i < FS; i++) {
      sim.process(l, r, 1);
      cylinders.forEach((c, k) => {
        const d = c.exhaustSend - prev[k];
        prev[k] = c.exhaustSend;
        largest = Math.max(largest, Math.abs(d));
        const j = jump[k];
        j.age++;
        if (j.age <= 2 && d * j.size < 0 && Math.abs(d) > 0.5 * Math.abs(j.size)) {
          spikes++;
          j.age = 9;
        }
        if (Math.abs(d) > 40_000) {
          j.size = d;
          j.age = 0;
        }
      });
    }
    expect(spikes).toBe(0);
    expect(largest).toBeLessThan(60_000);
  }, 60_000);
});

describe("Cross-Four X engines", () => {
  for (const key of ["saber-sb4", "saber-sb16", "saber-sb8-diesel"]) {
    it(`${key} idles steadily and pulls on the dyno`, () => {
      const spec = resolveEngineSpec({ ...SABER_PRESETS[key].config, seed: 1 });
      const sim = new EngineSimulator(spec, FS);
      const L = new Float32Array(4800);
      const R = new Float32Array(4800);
      sim.prewarm(3);
      sim.process(L, R);
      expect(L.every(Number.isFinite)).toBe(true);
      expect(Math.abs(sim.telemetry.rpm - spec.calibration.idleRpm)).toBeLessThan(0.25 * spec.calibration.idleRpm);
      sim.setControls({ mode: "dyno", targetRpm: 2000, throttle: 1 });
      sim.prewarm(2.5);
      // A long-stroke engine at 2000 rpm: at least 8 bar BMEP unboosted (torque = BMEP·V/4π).
      const bmepBar = (sim.telemetry.brakeTorqueNm * 4 * Math.PI) / (sim.displacementL / 1000) / 1e5;
      expect(bmepBar).toBeGreaterThan(key.endsWith("diesel") ? 9 : 8);
      expect(bmepBar).toBeLessThan(key.endsWith("diesel") ? 26 : 13.5);
    }, 60_000);
  }
});

describe("moving listener perspectives", () => {
  it("a pass-by shifts the pitch down by the Doppler ratio and swells as the vehicle passes", () => {
    // A pure 400 Hz monopole on the pass-by track at 27.8 m/s (the observer alone, no engine).
    const obs = new Observer(FS, "pass-by", [{ kind: "exhaust", position: { x: 0, y: 0, z: 0.4 } }]);
    const q = new Float64Array(1);
    const ear = new Float64Array(2);
    const seconds = 5;
    const out = new Float64Array(seconds * FS);
    const pos = new Float64Array(seconds * FS);
    for (let i = 0; i < out.length; i++) {
      q[0] = Math.sin((2 * Math.PI * 400 * i) / FS);
      obs.process(q, 0, ear);
      out[i] = ear[0];
      pos[i] = obs.trackPosition;
    }
    // Zero-crossing frequency over a quarter second.
    const freq = (from: number) => {
      let crossings = 0;
      for (let i = from + 1; i < from + FS / 4; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
      return crossings * 4;
    };
    const rms = (from: number) => {
      let sum = 0;
      for (let i = from; i < from + FS / 10; i++) sum += out[i] * out[i];
      return Math.sqrt(sum / (FS / 10));
    };
    // Starts 42 m before the listener: approaching for the first 1.2 s, well past by 3.5 s.
    const abeam = pos.findIndex((p, i) => i > 0 && pos[i - 1] < 0 && p >= 0);
    expect(abeam / FS).toBeGreaterThan(1.3);
    expect(abeam / FS).toBeLessThan(1.7);
    const approaching = freq(abeam - FS);
    const receding = freq(abeam + FS);
    // v/c = 27.8/346: +8.6 % approaching and −7.4 % receding, less a little for the 7.5 m offset.
    expect(approaching).toBeGreaterThan(424);
    expect(approaching).toBeLessThan(436);
    expect(receding).toBeGreaterThan(368);
    expect(receding).toBeLessThan(378);
    expect(rms(abeam)).toBeGreaterThan(2.5 * rms(abeam - FS));
    // No jumps: the largest sample-to-sample change stays that of a ≈ 430 Hz tone at the peak level.
    let peak = 0;
    let step = 0;
    for (let i = 1; i < out.length; i++) {
      peak = Math.max(peak, Math.abs(out[i]));
      step = Math.max(step, Math.abs(out[i] - out[i - 1]));
    }
    expect(step).toBeLessThan(peak * 2 * Math.PI * (440 / FS) * 1.1);
  });

  it("a fly-over runs an engine without a discontinuity at the end of the track", () => {
    const sim = new EngineSimulator(specOf("pw-r985"), 24000, { perspective: "fly-over" });
    sim.prewarm(1);
    const L = new Float32Array(24000 * 16);
    const R = new Float32Array(L.length);
    sim.process(L, R);
    expect(L.every(Number.isFinite)).toBe(true);
    // The track restarts about 13.3 s in (0.6 + 1 of a half-track at 62 m/s); the fade makes it silent there.
    const window = (t: number) => Math.max(...Array.from(L.subarray(Math.round(t * 24000), Math.round((t + 0.2) * 24000)), Math.abs));
    expect(window(10.75)).toBeLessThan(0.05 * window(5));
  }, 60_000);
});

describe("exhaust arrangements and cylinder counts", () => {
  const sb8 = (patch: Partial<EngineConfiguration>, quick: Partial<EngineConfiguration["quick"]> = {}) => {
    const base = SABER_PRESETS["saber-sb8"].config;
    return new EngineSimulator(resolveEngineSpec({ ...base, ...patch, quick: { ...base.quick, ...quick }, physical: { ...base.physical, ...patch.physical }, seed: 1 }), FS);
  };
  const outlets = (sim: EngineSimulator) => (sim as unknown as { exhaust: { outlets: Array<{ position: { x: number; y: number } }> } }).exhaust.outlets;

  it("an X engine can run twin, four, single, side and stack exhausts", () => {
    expect(outlets(sb8({}))).toHaveLength(2);
    expect(outlets(sb8({ advanced: { exhaustRouting: "separate" }, physical: { collector: "each-bank" } }))).toHaveLength(4);
    expect(outlets(sb8({ advanced: { exhaustRouting: "single" } }))).toHaveLength(1);
    expect(outlets(sb8({ advanced: { exhaustRouting: "open-headers" }, physical: { collector: "none" } }))).toHaveLength(8);
    const side = outlets(sb8({ physical: { exhaustExit: "side" } }));
    // Side pipes end beside the engine, one each side; rear pipes end behind the vehicle.
    expect(side.map((o) => Math.sign(o.position.x))).toEqual([-1, 1]);
    expect(side.every((o) => o.position.y > 0)).toBe(true);
    expect(outlets(sb8({})).every((o) => o.position.y < -2)).toBe(true);
  });

  it("a two-stroke X collects each side, or gives every cylinder a tuned pipe when asked", () => {
    const collected = sb8({}, { cycle: "two-stroke" });
    expect(outlets(collected)).toHaveLength(2);
    const tuned = sb8({ physical: { expansionChamber: true } }, { cycle: "two-stroke" });
    expect(outlets(tuned)).toHaveLength(8);
    collected.setControls({ mode: "dyno", targetRpm: 2000, throttle: 1 });
    collected.prewarm(3);
    expect(collected.telemetry.brakeTorqueNm).toBeGreaterThan(500);
  }, 60_000);

  it("every piston layout builds and idles with 24 cylinders", () => {
    for (const layout of ["inline", "v", "flat", "w", "radial", "x"] as const) {
      const spec = resolveEngineSpec({ quick: { layout, cylinderCount: 24, displacement: 12, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: layout === "radial" || layout === "x" ? 3000 : 6500 }, forcedInduction: { type: "na" }, seed: 1 });
      expect(spec.cylinders).toBe(24);
      const sim = new EngineSimulator(spec, 24000);
      sim.prewarm(2.5);
      expect(Math.abs(sim.telemetry.rpm - spec.calibration.idleRpm), layout).toBeLessThan(0.25 * spec.calibration.idleRpm);
    }
  }, 120_000);
});

describe("random configurations", () => {
  // A few seeds from the robustness sweep (scripts/fuzzConfigs.ts runs the full set): seed 34 as the
  // 10 L turbo inline-8 that once overran its soft limiter (its gasoline draw), seed 29 a diesel.
  const cases: Array<[number, boolean]> = [[3, true], [17, true], [34, false], [29, true]];
  for (const [seed, diesel] of cases) {
    it(`seed ${seed}${diesel ? "" : " (gasoline)"} idles, holds the dyno and respects its limiter`, () => {
      const r = runConfig(seed, FS, { diesel, twoStroke: false, rotary: false, x: false, large: false });
      expect(r.problems).toEqual([]);
    }, 120_000);
  }
});
