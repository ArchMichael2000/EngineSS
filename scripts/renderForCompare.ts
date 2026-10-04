/**
 * Render a reference engine at the operating condition of a recording, with its exact speed
 * track, for scripts/compareRecording.py.
 *
 *   npx vite-node scripts/renderForCompare.ts -- <engineKey> <perspective> sweep <rpm0> <rpm1> <seconds> <out-prefix>
 *   npx vite-node scripts/renderForCompare.ts -- <engineKey> <perspective> idle <seconds> <out-prefix>
 *   npx vite-node scripts/renderForCompare.ts -- <engineKey> <perspective> replay <track.json> <out-prefix>
 *
 * replay follows a recording's tracked speed ({t, rpm}, e.g. the rpm_track of compareRecording.py
 * analyse output) on the dyno, with the throttle open while the speed rises and closed while it
 * falls: free revs and pulls are reproduced at the recording's own speed history.
 *
 * Writes <out-prefix>.wav and <out-prefix>.track.json ({t, rpm}). PATCH='{json}' deep-merges into the config.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { EngineSimulator } from "../shared/ess/engine";
import { resolveEngineSpec } from "../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";
import type { Perspective } from "../shared/ess/observer";

const args = process.argv.slice(2).filter((a) => a !== "--");
const [key, perspective, mode] = args;
const SR = 48000;
// Optional deep-merge patch of the configuration (e.g. the recorded car's exhaust), via PATCH='{...}'.
function merge(base: any, patch: any): any {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(base?.[k], v);
  return out;
}
const config = merge(REFERENCE_ENGINES[key].config, process.env.PATCH ? JSON.parse(process.env.PATCH) : {});
const spec = resolveEngineSpec({ ...config, seed: 11 });
const sim = new EngineSimulator(spec, SR, { perspective: perspective as Perspective });
const replay = mode === "replay" ? (JSON.parse(readFileSync(args[3], "utf8")).rpm_track ?? JSON.parse(readFileSync(args[3], "utf8"))) as { t: number[]; rpm: number[] } : null;
const out = mode === "sweep" ? args[6] : args[4];
const seconds = replay ? replay.t[replay.t.length - 1] + 0.3 : Number(mode === "sweep" ? args[5] : args[3]);
const n = Math.round(seconds * SR);
const L = new Float32Array(n);
const R = new Float32Array(n);
const t: number[] = [];
const rpm: number[] = [];
const chunk = 240;
if (mode === "sweep") {
  const r0 = Number(args[3]);
  const r1 = Number(args[4]);
  sim.setControls({ mode: "dyno", targetRpm: r0, throttle: 1 });
  sim.prewarm(2);
  for (let o = 0; o < n; o += chunk) {
    sim.setControls({ targetRpm: r0 + (r1 - r0) * (o / n) });
    sim.process(L, R, Math.min(chunk, n - o), o);
    t.push(o / SR);
    rpm.push(sim.rpm);
  }
} else if (replay) {
  const at = (time: number): number => {
    const { t: tt, rpm: rr } = replay;
    if (time <= tt[0]) return rr[0];
    for (let i = 1; i < tt.length; i++) if (time <= tt[i]) return rr[i - 1] + ((rr[i] - rr[i - 1]) * (time - tt[i - 1])) / (tt[i] - tt[i - 1]);
    return rr[rr.length - 1];
  };
  sim.setControls({ mode: "dyno", targetRpm: at(0), throttle: 0.1 });
  sim.prewarm(2);
  for (let o = 0; o < n; o += chunk) {
    const time = o / SR;
    // Speed rising: pedal open (a free rev in neutral is near full throttle); falling: closed.
    const slope = (at(time + 0.08) - at(time - 0.08)) / 0.16;
    sim.setControls({ targetRpm: at(time), throttle: Math.max(0, Math.min(1, 0.08 + slope / 1500)) });
    sim.process(L, R, Math.min(chunk, n - o), o);
    t.push(time);
    rpm.push(sim.rpm);
  }
} else {
  sim.setControls({ mode: "free", throttle: 0 });
  sim.prewarm(3);
  for (let o = 0; o < n; o += chunk) {
    sim.process(L, R, Math.min(chunk, n - o), o);
    t.push(o / SR);
    rpm.push(sim.rpm);
  }
}
// Smooth the speed track over ~100 ms (the instantaneous value carries firing ripple).
const k = 20;
const smooth = rpm.map((_, i) => {
  let s = 0;
  let c = 0;
  for (let j = Math.max(0, i - k); j <= Math.min(rpm.length - 1, i + k); j++) {
    s += rpm[j];
    c++;
  }
  return s / c;
});
writeFileSync(`${out}.track.json`, JSON.stringify({ t, rpm: smooth }));
const buf = Buffer.alloc(44 + n * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, 0.5 * (L[i] + R[i]))) * 32767), 44 + i * 2);
writeFileSync(`${out}.wav`, buf);
console.log("wrote", out, "mean rpm", (rpm.reduce((a, b) => a + b, 0) / rpm.length).toFixed(0));
