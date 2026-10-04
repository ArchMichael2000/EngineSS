/**
 * Forced-induction acoustics verification: renders the turbo and supercharger events in isolation
 * (accessory stem only, dyno-held crank so the engine speed does not move) and checks frequencies,
 * levels and timings against the physics they come from and published figures.
 *
 *   npx vite-node scripts/verifyForcedInduction.ts [-- outDir]
 *
 * With an output directory, each scenario's accessory stem is also written as a WAV.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { EngineSimulator } from "../shared/ess/engine";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";
import type { EngineConfiguration } from "../shared/engineTypes";

const FS = 48000;
const outDir = process.argv.slice(2).filter((a) => a !== "--")[0];
if (outDir) mkdirSync(outDir, { recursive: true });

function config(key: string, fi: Partial<EngineConfiguration["forcedInduction"]> = {}): EngineConfiguration {
  const base = REFERENCE_ENGINES[key].config;
  return { ...base, seed: 1, forcedInduction: { ...base.forcedInduction, ...fi } };
}

function soloAccessory(sim: EngineSimulator): void {
  Object.assign(sim.stems, { exhaust: 0, exhaustJet: 0, valveJet: 0, intake: 0, structure: 0, accessory: 1 });
}

function render(sim: EngineSimulator, seconds: number, trace?: (t: number) => void): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  const r = new Float32Array(128);
  const l = new Float32Array(128);
  for (let i = 0; i < n; i += 128) {
    const m = Math.min(128, n - i);
    sim.process(l, r, m);
    out.set(l.subarray(0, m), i);
    trace?.(i / FS);
  }
  return out;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k);
        const wi = Math.sin(a * k);
        const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}

/** Averaged Hann power spectrum (dB), 8192-point frames. */
function spectrum(x: Float32Array): { db: Float64Array; hz: number } {
  const N = 8192;
  const acc = new Float64Array(N / 2);
  let frames = 0;
  for (let s = 0; s + N <= x.length; s += N / 2, frames++) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  const db = acc.map((p) => 10 * Math.log10(p / Math.max(1, frames) + 1e-30));
  return { db, hz: FS / N };
}

/** Strongest spectral peak within ±tol of f, and its prominence over the median of a ±1 kHz neighbourhood. */
function peakNear(sp: { db: Float64Array; hz: number }, f: number, tol: number): { hz: number; prominence: number } {
  const lo = Math.max(1, Math.floor((f - tol) / sp.hz));
  const hi = Math.min(sp.db.length - 1, Math.ceil((f + tol) / sp.hz));
  let best = lo;
  for (let k = lo; k <= hi; k++) if (sp.db[k] > sp.db[best]) best = k;
  const span = Math.round(1000 / sp.hz);
  const around: number[] = [];
  for (let k = Math.max(1, best - span); k < Math.min(sp.db.length, best + span); k++) around.push(sp.db[k]);
  around.sort((a, b) => a - b);
  return { hz: best * sp.hz, prominence: sp.db[best] - around[around.length >> 1] };
}

function rmsDb(x: Float32Array, from = 0, to = x.length): number {
  let e = 0;
  for (let i = from; i < to; i++) e += x[i] * x[i];
  return 10 * Math.log10(e / Math.max(1, to - from) + 1e-30);
}

function save(name: string, x: Float32Array): void {
  if (!outDir) return;
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + x.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(FS, 24);
  buf.writeUInt32LE(FS * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  writeFileSync(`${outDir}/${name}.wav`, buf);
}

export interface Check {
  name: string;
  value: string;
  expected: string;
  pass: boolean;
}
const checks: Check[] = [];
function check(name: string, value: number, lo: number, hi: number, unit = "", digits = 1): void {
  checks.push({ name, value: `${value.toFixed(digits)}${unit}`, expected: `${lo}–${hi}${unit}`, pass: value >= lo && value <= hi });
}

// ---- 1. Turbo whine at full boost (2JZ-GTE, 5000 rpm)
{
  const spec = resolveEngineSpec(config("toyota-2jz-gte"));
  const sim = new EngineSimulator(spec, FS);
  sim.setControls({ mode: "dyno", targetRpm: 5000, throttle: 1 });
  sim.prewarm(3);
  soloAccessory(sim);
  const t = sim.telemetry;
  const shaftHz = t.turboRpm / 60;
  const fi = spec.forcedInduction as { compressorBlades: number; compressorWheelDiameterMm: number; turbineBlades: number };
  const bpf = shaftHz * fi.compressorBlades;
  const x = render(sim, 2);
  save("turbo-whine-2jz-5000", x);
  const sp = spectrum(x);
  const p = peakNear(sp, bpf, 0.03 * bpf);
  // Published: small automotive turbos run 100–200 krpm at full boost, tip speed 400–520 m/s.
  check("2JZ shaft speed at full boost", t.turboRpm / 1000, 90, 220, " krpm", 0);
  check("2JZ compressor tip speed", (shaftHz * 2 * Math.PI * fi.compressorWheelDiameterMm) / 2000, 380, 520, " m/s", 0);
  check("2JZ blade-pass tone found at shaft × blades", Math.abs(p.hz / bpf - 1) * 100, 0, 1, " % off", 2);
  check("2JZ blade-pass tone prominence", p.prominence, 10, 60, " dB");
}

// ---- 2. Lift-off with a blow-off valve: vent duration and spectral centre
function liftOff(key: string, bov: boolean, name: string) {
  const spec = resolveEngineSpec(config(key, { bovEnabled: bov }));
  const sim = new EngineSimulator(spec, FS);
  sim.setControls({ mode: "dyno", targetRpm: 5000, throttle: 1 });
  sim.prewarm(3);
  soloAccessory(sim);
  const boost0 = sim.telemetry.boostKpa;
  sim.setControls({ throttle: 0 });
  const fiAny = (sim as unknown as { fi: { compressor: { massFlow: number } } }).fi;
  const flow: number[] = [];
  const boost: number[] = [];
  const x = render(sim, 2.5, () => {
    flow.push(fiAny.compressor.massFlow);
    boost.push(sim.telemetry.boostKpa);
  });
  save(name, x);
  return { x, flow, boost, boost0, hop: 128 / FS };
}
{
  const r = liftOff("toyota-2jz-gte", true, "bov-2jz-liftoff");
  // The valve's job is to keep the compressor out of surge: flow must never reverse. The wheel keeps
  // pumping through the open valve as it spins down, so boost halves quickly and then decays with
  // shaft speed (throttle-inlet pressure logs on tip-out show the same two-stage fall).
  check("BOV: compressor flow minimum (no surge)", Math.min(...r.flow), 0, 10, " kg/s", 3);
  const i50 = r.boost.findIndex((b) => b < 0.5 * r.boost0);
  check("BOV: boost halved in", i50 * r.hop * 1000, 50, 600, " ms", 0);
  // Vent energy: loud during the first 300 ms, quiet afterwards.
  const ventDb = rmsDb(r.x, 0, Math.round(0.3 * FS)) - rmsDb(r.x, Math.round(1.5 * FS));
  check("BOV: vent level over post-vent", ventDb, 10, 80, " dB");
  // Spectral centroid of the vent (published BOV recordings: broadband 1–6 kHz hiss).
  const sp = spectrum(r.x.subarray(0, Math.round(0.35 * FS)));
  let num = 0;
  let den = 0;
  for (let k = Math.round(200 / sp.hz); k < sp.db.length; k++) {
    const p = Math.pow(10, sp.db[k] / 10);
    num += p * k * sp.hz;
    den += p;
  }
  check("BOV: vent spectral centroid", num / den / 1000, 0.8, 7, " kHz", 2);
}

// ---- 3. Lift-off without a BOV: compressor surge ("flutter")
{
  const r = liftOff("toyota-2jz-gte", false, "flutter-2jz-liftoff");
  // Surge cycles: flow reversals with hysteresis (forward above +10 % of the WOT flow, reversed
  // below −2 %), so engine-pulse ripple around zero is not counted.
  const hi = 0.1 * r.flow[0];
  const lo = -0.02 * r.flow[0];
  let cycles = 0;
  let first = -1;
  let last = -1;
  let forward = true;
  for (let i = 1; i < r.flow.length && i * r.hop < 1.5; i++) {
    if (forward && r.flow[i] < lo) {
      forward = false;
      cycles++;
      if (first < 0) first = i;
      last = i;
    } else if (!forward && r.flow[i] > hi) forward = true;
  }
  const surgeHz = cycles > 1 ? (cycles - 1) / ((last - first) * r.hop) : 0;
  // Deep surge (flow reversal) runs at 50–90 % of the charge system's Helmholtz frequency (Dehner &
  // Selamet, OSU rig: 63 % with a 9.2 L plenum, 82 % with 1.15 L; ≈ 30 Hz measured), which with
  // ≈ 2 m of charge piping and 3–8 L of volume lands at ≈ 10–35 Hz on a car.
  const spec = resolveEngineSpec(config("toyota-2jz-gte"));
  const t = spec.forcedInduction as { compressorWheelDiameterMm: number; chargeVolumeL: number };
  const inducer = Math.PI * Math.pow((t.compressorWheelDiameterMm / 1000) * 0.36, 2);
  const helmholtz = (343 / (2 * Math.PI)) * Math.sqrt(inducer / (1.8 * (t.chargeVolumeL / 1000)));
  check("No BOV: deep-surge cycles (flow reversals) in 1.5 s", cycles, 8, 60, "", 0);
  check("No BOV: surge (flutter) frequency", surgeHz, 10, 35, " Hz");
  check("No BOV: surge / Helmholtz frequency", (surgeHz / helmholtz) * 100, 50, 100, " %", 0);
  const i10 = r.boost.findIndex((b) => b < 0.1 * r.boost0);
  check("No BOV: boost decays slower than with BOV", i10 < 0 ? 2500 : i10 * r.hop * 1000, 150, 2500, " ms", 0);
}

// ---- 4. Wastegate: holds target boost without large overshoot
{
  const cfg = config("subaru-ej257");
  const spec = resolveEngineSpec(cfg);
  const target = (spec.forcedInduction as { targetBoostKpa: number }).targetBoostKpa;
  const sim = new EngineSimulator(spec, FS);
  sim.setControls({ mode: "dyno", targetRpm: 5000, throttle: 0.1 });
  sim.prewarm(2);
  sim.setControls({ throttle: 1 });
  let peak = 0;
  const trace: number[] = [];
  for (let k = 0; k < 40; k++) {
    sim.prewarm(0.1);
    peak = Math.max(peak, sim.telemetry.boostKpa);
    trace.push(sim.telemetry.boostKpa);
  }
  const settled = trace.slice(-10).reduce((a, b) => a + b, 0) / 10;
  check("Wastegate: settled boost / target", (settled / target) * 100, 90, 106, " %", 1);
  check("Wastegate: overshoot", Math.max(0, (peak / target - 1) * 100), 0, 12, " %", 1);
  const i90 = trace.findIndex((b) => b > 0.9 * target);
  check("Wastegate: tip-in to 90 % boost at 5000 rpm", (i90 + 1) * 100, 100, 1500, " ms", 0);
}

// ---- 5. Twin-screw supercharger whine (Hellcat): pocket frequency and timing-gear mesh
{
  const spec = resolveEngineSpec(config("hellcat-6-2"));
  const sim = new EngineSimulator(spec, FS);
  sim.setControls({ mode: "dyno", targetRpm: 4000, throttle: 1 });
  sim.prewarm(2);
  soloAccessory(sim);
  const sc = spec.forcedInduction as { driveRatio: number; lobes: number; timingGearTeeth: number; type: string };
  const rotorHz = (4000 / 60) * sc.driveRatio;
  const pocketHz = rotorHz * (sc.type === "twin-screw" ? sc.lobes : sc.lobes * 2);
  const meshHz = rotorHz * sc.timingGearTeeth;
  const x = render(sim, 2);
  save("supercharger-hellcat-4000", x);
  const sp = spectrum(x);
  const p = peakNear(sp, pocketHz, 0.03 * pocketHz);
  const m = peakNear(sp, meshHz, 0.03 * meshHz);
  // Published: the 2.38 L IHI twin-screw on the Hellcat turns ≈ 2.4× crank (≈ 14 krpm at redline).
  check("Hellcat rotor speed at 4000 rpm", rotorHz * 60 / 1000, 7, 13, " krpm", 1);
  check("Hellcat pocket tone at rotor × lobes", Math.abs(p.hz / pocketHz - 1) * 100, 0, 1, " % off", 2);
  check("Hellcat pocket tone prominence", p.prominence, 6, 60, " dB");
  check("Hellcat timing-gear mesh prominence", m.prominence, 6, 60, " dB");
}

const w = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) console.log(`${c.pass ? "ok  " : "FAIL"} ${c.name.padEnd(w)}  ${c.value.padStart(12)}   expected ${c.expected}`);
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks pass`);
if (failed) process.exitCode = 1;
