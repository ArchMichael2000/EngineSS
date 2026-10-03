/**
 * Render the v16 physical core for every factory preset at the same operating
 * points as scripts/renderBaseline.ts, in the same raw format, so
 * scripts/analyzeBaseline.py measures both models identically.
 *
 *   npm run audit:render16 -- <outDir> [perspective] [presetKey]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EngineSimulator } from "../shared/ess/engine";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import type { Perspective } from "../shared/ess/observer";
import { FACTORY_PRESETS } from "../shared/engineTypes";
import type { EngineConfiguration } from "../shared/engineTypes";

const SR = 48000;
const args = process.argv.slice(2).filter((a) => a !== "--");
const outDir = args[0] ?? "v16-renders";
const perspective = (args[1] ?? "exterior-rear") as Perspective;
const only = args[2];
mkdirSync(outDir, { recursive: true });

const meta: Record<string, unknown> = {};

function wav(path: string, l: Float32Array, r: Float32Array): void {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(path, buf);
}

function save(name: string, l: Float32Array, r: Float32Array, info: Record<string, unknown>): void {
  const mono = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) * 0.5;
  writeFileSync(join(outDir, `${name}.f32`), Buffer.from(mono.buffer));
  meta[name] = info;
}

for (const [key, preset] of Object.entries(FACTORY_PRESETS)) {
  if (only && key !== only) continue;
  const config: EngineConfiguration = { ...preset.config, soundProfile: "v16", seed: 42 };
  const spec = resolveEngineSpec(config);
  const redline = config.quick.redline;
  const points: Array<[string, number, number, "free" | "dyno"]> = [
    ["idle", spec.calibration.idleRpm, 0, "free"],
    ["cruise3000", 3000, 0.22, "dyno"],
    ["wot3000", 3000, 1, "dyno"],
    ["wot60", Math.round(redline * 0.6), 1, "dyno"],
    ["wot90", Math.round(redline * 0.9), 1, "dyno"],
    ["overrun60", Math.round(redline * 0.6), 0, "dyno"],
  ];
  for (const [label, rpm, throttle, mode] of points) {
    const sim = new EngineSimulator(spec, SR, { perspective });
    sim.setControls({ mode, targetRpm: rpm, throttle, load: 0 });
    sim.prewarm(2.5);
    const n = Math.round(2.5 * SR);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    const t0 = performance.now();
    sim.process(l, r, n);
    const cpu = (performance.now() - t0) / 1000 / 2.5;
    save(`${key}__${label}`, l, r, { preset: key, label, rpm: Math.round(sim.rpm), throttle, cylinders: config.quick.cylinderCount, cpuRealtimeFactor: cpu, path: "v16", telemetry: { ...sim.telemetry } });
  }
  // WOT sweep 1000 → redline over 6 s on the dyno, then lift (overrun) for 2 s.
  const sim = new EngineSimulator(spec, SR, { perspective });
  sim.setControls({ mode: "dyno", targetRpm: 1000, throttle: 1 });
  sim.prewarm(2);
  const seconds = 6;
  const n = seconds * SR;
  const l = new Float32Array(n + 2 * SR);
  const r = new Float32Array(n + 2 * SR);
  const t0 = performance.now();
  for (let off = 0; off < n; off += 512) {
    const t = off / SR;
    sim.setControls({ targetRpm: 1000 + (redline - 1000) * Math.min(1, t / seconds), throttle: 1 });
    sim.process(l, r, Math.min(512, n - off), off);
  }
  const cpu = (performance.now() - t0) / 1000 / seconds;
  save(`${key}__sweep`, l.subarray(0, n), r.subarray(0, n), { preset: key, label: "sweep", rpmStart: 1000, rpmEnd: redline, seconds, cylinders: config.quick.cylinderCount, cpuRealtimeFactor: cpu, path: "v16" });
  // Lift-off for the listening file: free mode, throttle closed (fuel cut, afterfire).
  sim.setControls({ mode: "free", throttle: 0 });
  sim.process(l, r, 2 * SR, n);
  wav(join(outDir, `${key}_sweep_${perspective}.wav`), l, r);
  console.log("rendered", key, "cpu", cpu.toFixed(2));
}
writeFileSync(join(outDir, "meta.json"), JSON.stringify({ sampleRate: SR, renders: meta }, null, 2));
