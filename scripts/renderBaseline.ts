/**
 * Renders the shipped live AudioWorklet (COMBUSTION_PROCESSOR_CODE) and the offline
 * shared model to raw float32 files so the current sound can be measured objectively.
 *
 *   npm run audit:render -- <outDir>     (default: baseline-renders/)
 *   python3 scripts/analyzeBaseline.py <outDir>   (needs numpy)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMBUSTION_PROCESSOR_CODE } from "../legacy/combustionProcessor";
import { buildEngineSoundAnalysis, generateEnginePcm, resolveSoundTuningWeights } from "../legacy/engineSoundModel";
import { FACTORY_PRESETS } from "../shared/engineTypes";
import type { EngineConfiguration } from "../shared/engineTypes";

const SR = 44100;
const outDir = process.argv.slice(2).filter((arg) => arg !== "--")[0] ?? "baseline-renders";
mkdirSync(outDir, { recursive: true });

type Processor = { port: { onmessage: null | ((e: { data: unknown }) => void) }; process: (i: Float32Array[][], o: Float32Array[][]) => boolean };

function instantiate(): Processor {
  let Ctor: { new (): Processor } | null = null;
  class FakeProcessor { port = { onmessage: null as Processor["port"]["onmessage"] }; }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", `${COMBUSTION_PROCESSOR_CODE}\nreturn true;`)(
    FakeProcessor,
    (name: string, c: { new (): Processor }) => { if (name === "combustion-processor") Ctor = c; },
    SR,
  );
  return new (Ctor as unknown as { new (): Processor })();
}

function configure(p: Processor, config: EngineConfiguration) {
  const fi = config.forcedInduction;
  p.port.onmessage?.({
    data: {
      analysis: buildEngineSoundAnalysis(config),
      seed: config.seed ?? 42,
      sound: {
        redline: config.quick.redline, forcedType: fi.type, turboSpoolThreshold: fi.turboSpoolThreshold ?? 2000,
        turboSize: fi.turboSize ?? "balanced", maxBoost: fi.maxBoost ?? 15, wastegateEnabled: fi.wastegateEnabled ?? true,
        superchargerType: fi.superchargerType ?? "roots", whineIntensity: fi.whineIntensity ?? 0.6,
        audioProfile: config.soundProfile ?? "v15", layout: config.quick.layout, crankshaft: config.quick.crankshaft,
        exhaustCharacter: config.quick.exhaustCharacter, tuning: resolveSoundTuningWeights(config),
      },
    },
  });
}

/** Render the live worklet with a per-block control curve (rpm, throttle, load). */
function renderLive(config: EngineConfiguration, seconds: number, control: (t: number) => [number, number, number]) {
  const p = instantiate();
  configure(p, config);
  const blocks = Math.ceil((seconds * SR) / 128);
  const mono = new Float32Array(blocks * 128);
  const t0 = performance.now();
  for (let b = 0; b < blocks; b++) {
    const [rpm, throttle, load] = control((b * 128) / SR);
    p.port.onmessage?.({ data: { rpm, throttle, load } });
    const l = new Float32Array(128), r = new Float32Array(128);
    p.process([], [[l, r]]);
    for (let i = 0; i < 128; i++) mono[b * 128 + i] = (l[i] + r[i]) * 0.5;
  }
  const cpuSec = (performance.now() - t0) / 1000;
  return { mono, cpuSec };
}

const meta: Record<string, unknown> = {};
const save = (name: string, data: Float32Array, info: Record<string, unknown>) => {
  writeFileSync(join(outDir, `${name}.f32`), Buffer.from(data.buffer));
  meta[name] = info;
};

for (const [key, preset] of Object.entries(FACTORY_PRESETS)) {
  const config: EngineConfiguration = { ...preset.config, soundProfile: "v15", seed: 42 };
  const redline = config.quick.redline;
  // Steady-state points: rpm, throttle, load
  const points: Array<[string, number, number, number]> = [
    ["idle", 850, 0.05, 0.15],
    ["cruise3000", 3000, 0.3, 0.4],
    ["wot3000", 3000, 1, 1],
    ["wot60", Math.round(redline * 0.6), 1, 1],
    ["wot90", Math.round(redline * 0.9), 1, 1],
    ["overrun60", Math.round(redline * 0.6), 0, 0],
  ];
  for (const [label, rpm, thr, load] of points) {
    const { mono, cpuSec } = renderLive(config, 2.5, () => [rpm, thr, load]);
    save(`${key}__${label}`, mono, { preset: key, label, rpm, throttle: thr, load, cylinders: config.quick.cylinderCount, cpuRealtimeFactor: cpuSec / 2.5, path: "live" });
  }
  // WOT sweep 1000 -> redline in 6 s (matches UI sweep duration)
  const sweep = renderLive(config, 6, (t) => [1000 + (redline - 1000) * Math.min(1, t / 6), 1, 0.8]);
  save(`${key}__sweep`, sweep.mono, { preset: key, label: "sweep", rpmStart: 1000, rpmEnd: redline, seconds: 6, cylinders: config.quick.cylinderCount, cpuRealtimeFactor: sweep.cpuSec / 6, path: "live" });
  // Offline/export path at the same steady WOT point, for live-vs-export comparison
  const off = generateEnginePcm(config, { durationSec: 2.5, sampleRate: SR, profile: "steady", startRpm: Math.round(redline * 0.6), endRpm: Math.round(redline * 0.6), throttle: 1, load: 1 });
  const offMono = new Float32Array(off.left.length);
  for (let i = 0; i < offMono.length; i++) offMono[i] = (off.left[i] + off.right[i]) * 0.5;
  save(`${key}__offline_wot60`, offMono, { preset: key, label: "offline_wot60", rpm: Math.round(redline * 0.6), throttle: 1, load: 1, cylinders: config.quick.cylinderCount, path: "offline" });
  console.log("rendered", key);
}
writeFileSync(join(outDir, "meta.json"), JSON.stringify({ sampleRate: SR, renders: meta }, null, 2));
