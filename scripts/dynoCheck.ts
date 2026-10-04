/**
 * Simulated dyno against each reference engine's published peak torque and power.
 *
 *   npx vite-node scripts/dynoCheck.ts -- [engineKey ...]     (default: every engine with published figures)
 *
 * Same procedure as the tests: full throttle, dyno-held speed, 2.5 s prewarm, then the telemetry.
 */
import { EngineSimulator } from "../shared/ess/engine";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";

const FS = 48000;
const keys = process.argv.slice(2).filter((a) => a !== "--");
for (const key of keys.length ? keys : Object.keys(REFERENCE_ENGINES)) {
  const ref = REFERENCE_ENGINES[key];
  if (!ref.published) continue;
  const row: string[] = [];
  for (const kind of ["torque", "power"] as const) {
    const pub = kind === "torque" ? ref.published.peakTorqueNm : ref.published.peakPowerKw;
    if (!pub) continue;
    const [value, rpm] = pub;
    const sim = new EngineSimulator(resolveEngineSpec({ ...ref.config, seed: 1 }), FS);
    sim.setControls({ mode: "dyno", targetRpm: rpm, throttle: 1 });
    sim.prewarm(2.5);
    const t = sim.telemetry;
    const measured = kind === "torque" ? t.brakeTorqueNm : t.powerKw;
    row.push(`${kind} ${measured.toFixed(1)} vs ${value} @ ${rpm} (${((measured / value - 1) * 100).toFixed(1).padStart(5)} %)`);
  }
  console.log(`${key.padEnd(20)} ${row.join("   ")}`);
}
