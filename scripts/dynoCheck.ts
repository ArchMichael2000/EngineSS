/**
 * Simulated dyno against each reference engine's published peak torque and power.
 *
 *   npx vite-node scripts/dynoCheck.ts -- [engineKey ...]     (default: every engine with published figures)
 *
 * Full throttle, dyno-held speed, 4.5 s to settle, then the telemetry averaged over 0.5 s. (The tests use 2.5 s; an
 * engine whose published point sits close to its limiter, like the S54 at 7900 of 8000 rpm, is
 * still recovering from the approach at 2.5 s and reads up to 25 % low there.)
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
    sim.prewarm(4.5);
    // Mean of 20 readings over the next 0.5 s: one reading swings ±10 % on a four-cylinder diesel.
    let measured = 0;
    for (let k = 0; k < 20; k++) {
      sim.prewarm(0.025);
      measured += (kind === "torque" ? sim.telemetry.brakeTorqueNm : sim.telemetry.powerKw) / 20;
    }
    row.push(`${kind} ${measured.toFixed(1)} vs ${value} @ ${rpm} (${((measured / value - 1) * 100).toFixed(1).padStart(5)} %)`);
  }
  console.log(`${key.padEnd(20)} ${row.join("   ")}`);
}
