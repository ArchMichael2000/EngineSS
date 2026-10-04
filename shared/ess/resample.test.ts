import { describe, expect, it } from "vitest";
import { Upsampler } from "./resample";

function render(inRate: number, outRate: number, freq: number, n: number): Float32Array {
  let k = 0;
  const up = new Upsampler(inRate, outRate, (l, r, count) => {
    for (let i = 0; i < count; i++, k++) l[i] = r[i] = Math.sin((2 * Math.PI * freq * k) / inRate);
  });
  const out = new Float32Array(n);
  const dummy = new Float32Array(n);
  up.process(out, dummy, n);
  return out;
}

/** Amplitude at `freq` by correlation over the settled part of the buffer. */
function amplitude(x: Float32Array, rate: number, freq: number, from: number): number {
  let re = 0;
  let im = 0;
  const n = x.length - from;
  for (let i = from; i < x.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - from)) / n);
    re += x[i] * w * Math.cos((2 * Math.PI * freq * i) / rate);
    im += x[i] * w * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return (4 * Math.hypot(re, im)) / n;
}

describe("reduced-rate upsampler", () => {
  it("passes the audio band at unity gain", () => {
    for (const f of [100, 1000, 8000, 12000]) {
      const y = render(32000, 48000, f, 9600);
      expect(amplitude(y, 48000, f, 200), `${f} Hz`).toBeCloseTo(1, 2);
    }
    // Transition band starts above ≈ 0.75 of the reduced Nyquist: −0.2 dB at 13 kHz from 32 kHz.
    expect(amplitude(render(32000, 48000, 13000, 9600), 48000, 13000, 200)).toBeGreaterThan(0.97);
  });

  it("rejects the reduced-rate images by at least 60 dB", () => {
    // A 10 kHz tone at 32 kHz images at 22 kHz in the 48 kHz output.
    const y = render(32000, 48000, 10000, 9600);
    expect(20 * Math.log10(amplitude(y, 48000, 22000, 200))).toBeLessThan(-60);
  });
});
