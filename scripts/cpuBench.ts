/**
 * Real-time cost of the simulator per engine (render seconds per simulated second, one thread).
 *
 *   npx vite-node scripts/cpuBench.ts -- [engineKey ...] [--rate 48000] [--seconds 3]
 *
 * One second idle warm-up, then full throttle (free rev for one second, then dyno-held at 0.8 × redline).
 */
import { EngineSimulator } from "../shared/ess/engine";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";

const args = process.argv.slice(2).filter((a) => a !== "--");
const opt = (name: string, d: number) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args.splice(i, 2)[1]) : d; };
const rate = opt("rate", 48000);
const seconds = opt("seconds", 3);
const keys = args.length ? args : ["bugatti-w16", "ferrari-f140", "gm-ls3", "honda-k20a", "mazda-13b-fc", "vw-ea288", "yamaha-rd350lc"];
for (const key of keys) {
  const spec = resolveEngineSpec({ ...REFERENCE_ENGINES[key].config, seed: 1 } as any);
  const sim = new EngineSimulator(spec, rate);
  const L = new Float32Array(128), R = new Float32Array(128);
  sim.setControls({ mode: "free", throttle: 0 });
  for (let i = 0; i < rate / 128; i++) sim.process(L, R, 128);
  const blocks = Math.floor((seconds * rate) / 128);
  const t0 = performance.now();
  for (let i = 0; i < blocks; i++) {
    if (i === Math.floor(rate / 128)) sim.setControls({ throttle: 1 });
    if (i === Math.floor((2 * rate) / 128)) sim.setControls({ mode: "dyno", targetRpm: 0.8 * spec.calibration.revLimiterRpm, throttle: 1 });
    sim.process(L, R, 128);
  }
  const rt = (performance.now() - t0) / 1000 / ((blocks * 128) / rate);
  console.log(`${key.padEnd(16)} ${(rt * 100).toFixed(0).padStart(4)} % of real time at ${rate} Hz (estimate ${(sim.costEstimate * 100).toFixed(0)} %)`);
}
