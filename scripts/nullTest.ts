/**
 * Null test for performance changes: render a fixed program and write raw float32 output, so two
 * builds can be compared sample by sample (scripts/nullCompare.py).
 *
 *   npx vite-node scripts/nullTest.ts -- <engineKey> <out.f32> [rate]
 *
 * Program: 1 s idle, 1 s free-rev at full throttle, 1.5 s dyno-held at 0.7 × limiter, 1 s lift-off.
 */
import { writeFileSync } from "node:fs";
import { EngineSimulator } from "../shared/ess/engine";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";

const [key, out, rateS] = process.argv.slice(2).filter((a) => a !== "--");
const rate = Number(rateS ?? 48000);
const spec = resolveEngineSpec({ ...REFERENCE_ENGINES[key].config, seed: 7 } as any);
const sim = new EngineSimulator(spec, rate);
const n = Math.round(4.5 * rate);
const L = new Float32Array(n), R = new Float32Array(n);
const torque: number[] = [];
sim.setControls({ mode: "free", throttle: 0 });
for (let o = 0; o < n; o += 128) {
  const t = o / rate;
  if (t >= 1 && t < 2) sim.setControls({ mode: "free", throttle: 1 });
  else if (t >= 2 && t < 3.5) sim.setControls({ mode: "dyno", targetRpm: 0.7 * spec.calibration.revLimiterRpm, throttle: 1 });
  else if (t >= 3.5) sim.setControls({ mode: "free", throttle: 0 });
  sim.process(L.subarray(o, Math.min(n, o + 128)), R.subarray(o, Math.min(n, o + 128)), Math.min(128, n - o));
  if (t >= 3.0 && t < 3.5) torque.push(sim.telemetry.brakeTorqueNm);
}
writeFileSync(out, Buffer.from(L.buffer));
console.log(`${key}: dyno torque ${(torque.reduce((a, b) => a + b, 0) / torque.length).toFixed(2)} N·m`);
