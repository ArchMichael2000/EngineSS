/**
 * Level and stem survey: renders presets through the programs the app offers and writes what the
 * listener gets (after the output leveler) next to the calibrated pressure and its stems, for
 * `scripts/analyzeLevels.py`.
 *
 *   npx vite-node scripts/levelSurvey.ts -- <outDir> [presetKey ...]
 *
 * Environment:
 *   PROGRAMS  comma list of idle,pull,drive,freerev (default: all four)
 *   STEMS     "1" also renders each stem alone (exhaust, exhaustJet, intake, structure, accessory,
 *             and the exhaust without the valve-throat jet) without leveling, for source isolation
 *   PERSPECTIVE listener (default exterior-rear)
 *   RATE      sample rate (default 48000)
 *   PATCH     JSON deep-merged into every config
 *
 * Programs:
 *   idle     6 s at idle, free running
 *   pull     the app's dyno pull: full throttle on the dyno from idle to the redline in 8 s, 2 s lift
 *   drive    Drive mode: standing start at full throttle with automatic shifts to 100 km/h, 1.5 s lift
 *   freerev  free running: 1 s idle, full throttle onto the limiter for 2.5 s, 1.5 s lift
 *
 * Files: <key>.<program>.live.wav (leveled, what is heard), <key>.<program>.raw.wav (full-scale
 * units, 32-bit float, may exceed ±1), <key>.<program>.<stem>.wav and <key>.<program>.json (rpm,
 * road speed, gear and leveler gain every 50 ms).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EngineSimulator } from "../shared/ess/engine";
import type { EngineControls, StemGains } from "../shared/ess/engine";
import { OutputLeveler } from "../shared/ess/leveler";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";
import { FACTORY_PRESETS, SABER_PRESETS } from "../shared/engineTypes";
import type { EngineConfiguration } from "../shared/engineTypes";
import type { Perspective } from "../shared/ess/observer";

const args = process.argv.slice(2).filter((a) => a !== "--");
const outDir = args[0];
if (!outDir) throw new Error("usage: levelSurvey.ts <outDir> [presetKey ...]");
mkdirSync(outDir, { recursive: true });
const ALL: Record<string, { name: string; config: EngineConfiguration }> = { ...REFERENCE_ENGINES, ...SABER_PRESETS, ...FACTORY_PRESETS };
const keys = args.length > 1 ? args.slice(1) : Object.keys(ALL);
const programs = (process.env.PROGRAMS ?? "idle,pull,drive,freerev").split(",");
const perspective = (process.env.PERSPECTIVE ?? "exterior-rear") as Perspective;
const fs = Number(process.env.RATE ?? 48000);
/** Stems that radiate on their own. The valve-throat jet is injected into the exhaust ducts, so it is isolated by difference: "exhaustNoValveJet" is the exhaust stem with that source off. */
const STEM_KEYS: Array<keyof StemGains> = ["exhaust", "exhaustJet", "intake", "structure", "accessory"];
const SOLOS = [...STEM_KEYS, "exhaustNoValveJet"] as const;
type Solo = (typeof SOLOS)[number];
const CHUNK = 256;

function merge(base: any, patch: any): any {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const result: any = { ...base };
  for (const [k, v] of Object.entries(patch)) result[k] = merge(base?.[k], v);
  return result;
}

function writeFloatWav(path: string, left: Float32Array, right: Float32Array, n: number): void {
  const buf = Buffer.alloc(44 + n * 8);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(fs, 24); buf.writeUInt32LE(fs * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write("data", 36); buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(left[i], 44 + i * 8);
    buf.writeFloatLE(right[i], 48 + i * 8);
  }
  writeFileSync(path, buf);
}

interface Track { t: number; rpm: number; kmh: number; gear: number; throttle: number; limiter: boolean }

/** One run. `solo` renders that stem alone. Returns the samples and the telemetry track. */
function run(config: EngineConfiguration, program: string, solo: Solo | null) {
  const spec = resolveEngineSpec(config);
  const sim = new EngineSimulator(spec, fs, { perspective, monitorGainDb: config.listener?.monitorGainDb ?? 0 });
  if (solo) {
    for (const k of STEM_KEYS) sim.stems[k] = k === solo || (k === "exhaust" && solo === "exhaustNoValveJet") ? 1 : 0;
    if (solo === "exhaustNoValveJet") sim.stems.valveJet = 0;
  }
  const idle = spec.calibration.idleRpm;
  const redline = spec.calibration.redlineRpm;
  const maxSec = program === "idle" ? 6 : program === "pull" ? 10 : program === "drive" ? 16 : 5;
  const left = new Float32Array(maxSec * fs);
  const right = new Float32Array(maxSec * fs);
  const track: Track[] = [];
  const effort: number[] = [];
  const hold: boolean[] = [];
  let endAt = maxSec;
  const control = (t: number): Partial<EngineControls> => {
    if (program === "idle") return { mode: "free", throttle: 0, load: 0 };
    if (program === "pull") return t < 8 ? { mode: "dyno", targetRpm: Math.max(idle, 1000) + (redline - Math.max(idle, 1000)) * (t / 8), throttle: 1 } : { mode: "free", throttle: 0, load: 0 };
    if (program === "drive") return { mode: "vehicle", autoShift: true, throttle: t < endAt - 1.5 ? 1 : 0 };
    return { mode: "free", load: 0, throttle: t >= 1 && t < 3.5 ? 1 : 0 };
  };
  sim.setControls({ mode: "free", throttle: 0, load: 0, targetRpm: idle, ...control(0), ...(program === "drive" ? { throttle: 0 } : {}) } as EngineControls);
  sim.prewarm(2.5);
  let n = 0;
  let nextMark = 0;
  while (n < left.length && n / fs < endAt) {
    const t = n / fs;
    sim.setControls(control(t));
    const m = Math.min(CHUNK, left.length - n);
    sim.process(left, right, m, n);
    effort.push(sim.effort);
    hold.push(!sim.isRunning);
    n += m;
    const tel = sim.telemetry;
    if (program === "drive" && endAt === maxSec && tel.speedKmh >= 100) endAt = Math.min(maxSec, t + 1.5);
    if (t >= nextMark) {
      track.push({ t: +t.toFixed(3), rpm: Math.round(sim.rpm), kmh: +tel.speedKmh.toFixed(1), gear: tel.gear, throttle: sim.currentControls.throttle, limiter: tel.limiter });
      nextMark += 0.05;
    }
  }
  return { left, right, n, track, effort, hold };
}

for (const key of keys) {
  const preset = ALL[key];
  if (!preset) throw new Error(`unknown preset ${key}`);
  const config = merge({ ...preset.config, seed: 11 }, process.env.PATCH ? JSON.parse(process.env.PATCH) : {}) as EngineConfiguration;
  for (const program of programs) {
    const started = performance.now();
    const { left, right, n, track, effort, hold } = run(config, program, null);
    writeFloatWav(join(outDir, `${key}.${program}.raw.wav`), left, right, n);
    // The live chain: the worklet's leveler, which has been running since the engine started.
    const leveler = new OutputLeveler(fs, { autoGain: config.listener?.autoLevel ?? true });
    const liveL = left.slice(0, n);
    const liveR = right.slice(0, n);
    const warm = Math.min(n, fs);
    for (let pass = 0; pass < 4; pass++) {
      const warmL = liveL.slice(0, warm);
      const warmR = liveR.slice(0, warm);
      for (let off = 0, c = 0; off < warm; off += CHUNK, c++) {
        const m = Math.min(CHUNK, warm - off);
        leveler.effort = effort[c];
        leveler.hold = hold[c];
        leveler.process(warmL.subarray(off, off + m), warmR.subarray(off, off + m), m);
      }
    }
    const gains: number[] = [];
    // Share of the run the limiter spends more than 1 dB and 3 dB down (per 256-sample chunk).
    let limited1 = 0;
    let limited3 = 0;
    let chunkCount = 0;
    const perMark = Math.round((0.05 * fs) / CHUNK);
    for (let off = 0, c = 0; off < n; off += CHUNK, c++) {
      const m = Math.min(CHUNK, n - off);
      leveler.effort = effort[c];
      leveler.hold = hold[c];
      leveler.process(liveL.subarray(off, off + m), liveR.subarray(off, off + m), m);
      chunkCount++;
      if (leveler.lastLimiterGain < 0.891) limited1++;
      if (leveler.lastLimiterGain < 0.708) limited3++;
      if (c % perMark === 0) gains.push(+(20 * Math.log10(Math.max(1e-6, leveler.lastGain))).toFixed(2));
    }
    writeFloatWav(join(outDir, `${key}.${program}.live.wav`), liveL, liveR, n);
    writeFileSync(join(outDir, `${key}.${program}.json`), JSON.stringify({ key, name: preset.name, program, perspective, sampleRate: fs, latency: leveler.latency, track, gainDb: gains, limiterOver1dB: limited1 / chunkCount, limiterOver3dB: limited3 / chunkCount }));
    if (process.env.STEMS === "1") {
      for (const stem of SOLOS) {
        const s = run(config, program, stem);
        writeFloatWav(join(outDir, `${key}.${program}.${stem}.wav`), s.left, s.right, s.n);
      }
    }
    console.log(`${key} ${program}: ${(n / fs).toFixed(1)} s in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  }
}
