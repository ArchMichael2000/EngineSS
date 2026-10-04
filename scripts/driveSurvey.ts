/**
 * Vehicle mode across engine families: full-throttle standing start with automated shifts.
 *
 *   npx vite-node scripts/driveSurvey.ts -- [engineKey ...]
 *
 * Reports the drivetrain the resolver chose, 0–60 / 0–100 km/h times, the gear reached, launch
 * slip and any stall (engine below 40 % of idle) or limiter bouncing at the shift points.
 */
import { EngineSimulator } from "../shared/ess/engine";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";

const keys = process.argv.slice(2).filter((a) => a !== "--");
for (const key of keys.length ? keys : Object.keys(REFERENCE_ENGINES)) {
  const spec = resolveEngineSpec({ ...REFERENCE_ENGINES[key].config, seed: 1 } as any);
  const v = spec.vehicle;
  const sim = new EngineSimulator(spec, 48000);
  sim.setControls({ mode: "vehicle", throttle: 0, autoShift: true });
  sim.prewarm(1.5);
  sim.setControls({ throttle: 1 });
  let t = 0, t60 = NaN, t100 = NaN, minRpm = 1e9, stalled = false, limiterChunks = 0, chunks = 0, maxGear = 0;
  while (t < 15 && Number.isNaN(t100)) {
    sim.prewarm(0.05);
    t += 0.05;
    const tel = sim.telemetry;
    minRpm = Math.min(minRpm, sim.rpm);
    if (sim.rpm < spec.calibration.idleRpm * 0.4) stalled = true;
    if (tel.limiter) limiterChunks++;
    chunks++;
    maxGear = Math.max(maxGear, tel.gear);
    if (Number.isNaN(t60) && tel.speedKmh >= 60) t60 = t;
    if (tel.speedKmh >= 100) t100 = t;
  }
  const tel = sim.telemetry;
  console.log(`${key.padEnd(20)} ${v.massKg.toFixed(0).padStart(5)} kg ${v.gearRatios.length}sp r${v.tireRadiusM} fd ${v.finalDrive.toFixed(2)} | 0-60 ${t60.toFixed(1).padStart(5)} s  0-100 ${t100.toFixed(1).padStart(5)} s | gear ${maxGear} | min rpm ${minRpm.toFixed(0)}${stalled ? " STALL" : ""} | limiter ${((limiterChunks / chunks) * 100).toFixed(0)} % | end ${tel.speedKmh.toFixed(0)} km/h ${sim.rpm.toFixed(0)} rpm`);
}
