import { describe, expect, it } from "vitest";
import { OutputLeveler } from "./leveler";

const FS = 48000;
function sine(amp: number, freq: number, seconds: number): Float32Array {
  const n = Math.round(seconds * FS);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS);
  return x;
}
const peak = (x: Float32Array, from = 0) => x.subarray(from).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
/** Level of the harmonics 2f…10f relative to the fundamental, via single-bin DFTs over whole periods. */
function harmonicsDb(x: Float32Array, freq: number): number {
  const n = Math.floor((x.length * freq) / FS) * Math.round(FS / freq);
  const seg = x.subarray(x.length - n);
  const bin = (k: number) => {
    let re = 0, im = 0;
    for (let i = 0; i < seg.length; i++) { const a = (2 * Math.PI * k * freq * i) / FS; re += seg[i] * Math.cos(a); im += seg[i] * Math.sin(a); }
    return re * re + im * im;
  };
  let h = 0;
  for (let k = 2; k <= 10; k++) h += bin(k);
  return 10 * Math.log10(h / bin(1));
}

describe("output leveler", () => {
  it("holds a signal 12 dB over full scale under the ceiling without waveshaping it", () => {
    const l = sine(4, 220, 3);
    const r = l.slice();
    new OutputLeveler(FS).process(l, r);
    expect(peak(l, FS)).toBeLessThanOrEqual(0.8);
    // A per-sample clipper at this level puts the harmonics within ~10 dB of the fundamental.
    expect(harmonicsDb(l, 220)).toBeLessThan(-50);
  });

  it("settles a loud sustained signal near the −6 dBFS target", () => {
    const l = sine(4, 150, 4);
    const r = l.slice();
    new OutputLeveler(FS).process(l, r);
    const p = peak(l, 3 * FS);
    expect(20 * Math.log10(p)).toBeGreaterThan(-8);
    expect(20 * Math.log10(p)).toBeLessThan(-4);
  });

  it("boosts a quiet signal by at most 12 dB, and not at all with auto gain off", () => {
    const quiet = sine(0.01, 100, 8);
    const l = quiet.slice(), r = quiet.slice();
    new OutputLeveler(FS).process(l, r);
    expect(peak(l, 7 * FS) / 0.01).toBeLessThan(4.05);
    expect(peak(l, 7 * FS) / 0.01).toBeGreaterThan(3.5);
    const l2 = quiet.slice(), r2 = quiet.slice();
    new OutputLeveler(FS, { autoGain: false }).process(l2, r2);
    expect(peak(l2, FS) / 0.01).toBeCloseTo(1, 2);
  });

  it("catches a sudden transient with the look-ahead limiter (no sample past full scale)", () => {
    const x = new Float32Array(FS);
    for (let i = 24000; i < 24480; i++) x[i] = 6 * Math.sin((2 * Math.PI * 500 * i) / FS);
    const r = x.slice();
    new OutputLeveler(FS, { autoGain: false }).process(x, r);
    expect(peak(x)).toBeLessThanOrEqual(1);
    expect(peak(x)).toBeGreaterThan(0.6);
  });

  it("delays by the look-ahead and passes non-finite input as silence", () => {
    const lev = new OutputLeveler(FS, { autoGain: false });
    const x = new Float32Array(1000);
    x[10] = 0.5;
    x[20] = NaN;
    const r = x.slice();
    lev.process(x, r);
    expect(x[10 + lev.latency]).toBeCloseTo(0.5, 5);
    expect(x.every((v) => Number.isFinite(v))).toBe(true);
  });
  it("never lets a sample past the ceiling, whatever the burst pattern", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const x = new Float32Array(2 * FS);
    for (let burst = 0; burst < 60; burst++) {
      const at = Math.floor(rand() * (x.length - 600));
      const amp = 0.5 + rand() * 20;
      const len = 1 + Math.floor(rand() * 500);
      for (let k = 0; k < len; k++) x[at + k] += amp * (rand() * 2 - 1);
    }
    const r = x.map((v) => -0.7 * v);
    new OutputLeveler(FS, { autoGain: false }).process(x, r);
    const ceiling = Math.pow(10, -2 / 20) + 1e-6;
    expect(peak(x)).toBeLessThanOrEqual(ceiling);
    expect(peak(r)).toBeLessThanOrEqual(ceiling);
  });
});
