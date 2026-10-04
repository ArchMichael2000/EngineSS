/**
 * Full-load torque and power curve on the simulated dyno.
 *
 *   npx vite-node scripts/torqueCurve.ts -- <engineKey> <rpm0> <rpm1> <step> [PATCH json via env]
 */
import { EngineSimulator } from "../shared/ess/engine";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";

const [key, r0, r1, step] = process.argv.slice(2).filter((a) => a !== "--");
function merge(base: any, patch: any): any {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(base?.[k], v);
  return out;
}
const config = merge(REFERENCE_ENGINES[key].config, process.env.PATCH ? JSON.parse(process.env.PATCH) : {});
const spec = resolveEngineSpec({ ...config, seed: 1 });
const rows: Array<{ rpm: number; torque: number; power: number }> = [];
for (let rpm = Number(r0); rpm <= Number(r1); rpm += Number(step)) {
  const sim = new EngineSimulator(spec, 48000);
  sim.setControls({ mode: "dyno", targetRpm: rpm, throttle: 1 });
  sim.prewarm(2.5);
  rows.push({ rpm, torque: sim.telemetry.brakeTorqueNm, power: sim.telemetry.powerKw });
}
const peak = Math.max(...rows.map((r) => r.torque));
for (const r of rows) console.log(`${String(r.rpm).padStart(6)} rpm  ${r.torque.toFixed(1).padStart(6)} N·m (${((r.torque / peak) * 100).toFixed(0).padStart(3)} %)  ${r.power.toFixed(1).padStart(6)} kW`);
console.log(JSON.stringify(rows));
