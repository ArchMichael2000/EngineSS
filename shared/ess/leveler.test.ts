import { describe, expect, it } from "vitest";
import { OutputLeveler, volumeToGain } from "./leveler";

const FS = 48000;
function sine(amp: number, freq: number, seconds: number): Float32Array {
  const n = Math.round(seconds * FS);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS);
  return x;
}
/** BS.1770 K-weighted loudness of a stereo pair, LUFS (ungated; 48 kHz coefficients from the standard). */
function lufs(l: Float32Array, r: Float32Array): number {
  const weigh = (x: Float32Array) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0, sum = 0;
    for (let i = 0; i < x.length; i++) {
      const y = 1.53512485958697 * x[i] - 2.69169618940638 * x1 + 1.19839281085285 * x2 + 1.69065929318241 * y1 - 0.73248077421585 * y2;
      const z = y - 2 * y1 + y2 + 1.99004745483398 * z1 - 0.99007225036621 * z2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y; z2 = z1; z1 = z;
      sum += z * z;
    }
    return sum / x.length;
  };
  return -0.691 + 10 * Math.log10(weigh(l) + weigh(r));
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

  it("brings signals 50 dB apart to the same loudness, and to the target", () => {
    // 150 Hz at +12 dBFS and at −38 dBFS: a straight-piped V10 and a diesel, both at full load.
    const out = [4, 0.0126].map((amp) => {
      const l = sine(amp, 150, 8);
      const r = l.slice();
      new OutputLeveler(FS).process(l, r);
      return lufs(l.subarray(7 * FS), r.subarray(7 * FS));
    });
    expect(Math.abs(out[0] - out[1])).toBeLessThan(0.5);
    expect(out[0]).toBeGreaterThan(-9);
    expect(out[0]).toBeLessThan(-7);
  });

  it("places idle 15 dB under full effort for every engine", () => {
    const level = (amp: number, effort: number) => {
      const l = sine(amp, 150, 8);
      const r = l.slice();
      const lev = new OutputLeveler(FS);
      lev.effort = effort;
      lev.process(l, r);
      return lufs(l.subarray(7 * FS), r.subarray(7 * FS));
    };
    for (const amp of [0.5, 0.002]) {
      expect(level(amp, 1) - level(amp, 0)).toBeGreaterThan(14);
      expect(level(amp, 1) - level(amp, 0)).toBeLessThan(16);
      expect(level(amp, 0.5) - level(amp, 0)).toBeGreaterThan(6.5);
      expect(level(amp, 0.5) - level(amp, 0)).toBeLessThan(8.5);
    }
  });

  it("leaves the level alone with auto gain off, and while held", () => {
    const quiet = sine(0.01, 100, 4);
    const l = quiet.slice(), r = quiet.slice();
    new OutputLeveler(FS, { autoGain: false }).process(l, r);
    expect(peak(l, FS) / 0.01).toBeCloseTo(1, 2);
    // Engine stopped: the gain stays where the running engine left it instead of rising on the silence.
    const lev = new OutputLeveler(FS);
    const a = sine(0.2, 100, 4), b = a.slice();
    lev.process(a, b);
    const settled = lev.lastGain;
    lev.hold = true;
    const tail = sine(0.0005, 100, 4), tail2 = tail.slice();
    lev.process(tail, tail2);
    expect(lev.lastGain / settled).toBeCloseTo(1, 2);
  });

  it("does not duck the engine for a single bang 30 dB over it", () => {
    // Steady 200 Hz with one 30 ms burst 30 dB higher at 4 s: a flat-shift afterfire in a 0–100 run.
    const n = 7 * FS;
    const l = sine(0.05, 200, 7);
    for (let i = 4 * FS; i < 4 * FS + 0.03 * FS; i++) l[i] += 1.6 * Math.sin((2 * Math.PI * 90 * i) / FS);
    const r = l.slice();
    const before = l.slice();
    const lev = new OutputLeveler(FS);
    lev.process(l, r);
    const gainAt = (t: number) => {
      const from = Math.round(t * FS), to = from + Math.round(0.1 * FS);
      return 20 * Math.log10(peak(l.subarray(from + lev.latency, to + lev.latency)) / peak(before.subarray(from, to)));
    };
    const settled = gainAt(3.8);
    // (The previous leveler sat 15 dB down for the next three seconds.)
    expect(settled - gainAt(4.3)).toBeLessThan(4);
    expect(settled - gainAt(5)).toBeLessThan(1.5);
    expect(peak(l)).toBeLessThanOrEqual(Math.pow(10, -2 / 20) + 1e-6);
    expect(n).toBe(l.length);
  });

  it("applies the listener volume without passing the ceiling", () => {
    const level = (volume: number) => {
      const l = sine(0.3, 150, 6);
      const r = l.slice();
      const lev = new OutputLeveler(FS);
      lev.volume = volumeToGain(volume);
      lev.effort = 0;
      lev.process(l, r);
      // (the control moves over 30 ms, so the first second is left out of the silence check)
      return { lufs: lufs(l.subarray(5 * FS), r.subarray(5 * FS)), peak: peak(l), late: peak(l, FS) };
    };
    const zero = level(0);
    expect(level(-100).late).toBeLessThan(1e-9);
    expect(zero.lufs - level(-50).lufs).toBeGreaterThan(11.5);
    expect(zero.lufs - level(-50).lufs).toBeLessThan(12.5);
    // Quiet running (idle effort) comes up by most of the 12 dB; nothing passes the ceiling.
    expect(level(100).lufs - zero.lufs).toBeGreaterThan(9);
    expect(level(100).peak).toBeLessThanOrEqual(Math.pow(10, -2 / 20) + 1e-6);
  });

  it("does not ride sparse pulses up into the limiter", () => {
    // 25 pulses a second, each 2 ms long at −3 dBFS over a −40 dBFS bed: an engine on its rev
    // limiter, or a two-stroke popping at idle. With a slow envelope the gain rode 8 dB too high
    // and the limiter took it back on every pulse.
    const n = 4 * FS;
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const inPulse = i % (FS / 25) < FS * 0.002;
      l[i] = (inPulse ? 0.7 : 0.01) * Math.sin((2 * Math.PI * 300 * i) / FS);
    }
    const r = l.slice();
    const lev = new OutputLeveler(FS);
    const before = l.slice();
    lev.process(l, r);
    // Gain over the last second, measured on the pulses themselves (delayed by the look-ahead).
    let ratioMin = Infinity;
    let ratioMax = 0;
    for (let i = 3 * FS; i < n - lev.latency; i++) {
      const x = Math.abs(before[i]);
      if (x > 0.5) {
        const g = Math.abs(l[i + lev.latency]) / x;
        ratioMin = Math.min(ratioMin, g);
        ratioMax = Math.max(ratioMax, g);
      }
    }
    // Pulses pass at one steady gain near the −4.5 dBFS peak target (−3 dBFS in, so about −1.5 dB of gain).
    expect(20 * Math.log10(ratioMax)).toBeLessThan(0.5);
    expect(20 * Math.log10(ratioMax / ratioMin)).toBeLessThan(1);
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
