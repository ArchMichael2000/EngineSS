import { describe, expect, it } from "vitest";
import { createRpmFollower } from "./displaySmoothing";
import { TOP_PACE, viewPace } from "./enginePace";
import { volumeToGain } from "../../../shared/ess/leveler";

describe("engine view pace", () => {
  it("keeps the idle pace it had and rises steeply above idle", () => {
    const idle = 800, red = 6500;
    expect(viewPace(idle, idle, red)).toBeCloseTo(0.35 + (0.85 * idle) / red, 6);
    expect(viewPace(red, idle, red)).toBeCloseTo(TOP_PACE, 6);
    expect(viewPace(9000, idle, red)).toBeCloseTo(TOP_PACE, 6);
    // Half way up it is already more than three times the idle pace (the old mapping gave 1.6 times).
    expect(viewPace((idle + red) / 2, idle, red) / viewPace(idle, idle, red)).toBeGreaterThan(3);
    let last = 0;
    for (let rpm = 0; rpm <= red; rpm += 50) {
      const p = viewPace(rpm, idle, red);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});

describe("gauge speed follower", () => {
  const run = (speedAt: (t: number) => number, seconds: number) => {
    const f = createRpmFollower();
    const out: Array<{ t: number; shown: number; real: number }> = [];
    for (let t = 0; t < seconds; t += 1 / 60) out.push({ t, shown: f.step(speedAt(t), 1 / 60), real: speedAt(t) });
    return out;
  };
  it("follows a dyno pull and the fall after it without the low-pass lag", () => {
    // 2 s at 1000 rpm, 6 s up to 7000, 0.4 s held, then down at 4000 rpm/s.
    const speed = (t: number) => (t < 2 ? 1000 : t < 8 ? 1000 + 1000 * (t - 2) : t < 8.4 ? 7000 : Math.max(1000, 7000 - 4000 * (t - 8.4)));
    const out = run(speed, 10.5);
    const worst = (a: number, b: number) => Math.max(...out.filter((o) => o.t >= a && o.t < b).map((o) => Math.abs(o.shown - o.real)));
    // A 0.25 s low-pass alone is 250 rpm behind on this pull and 1000 behind on the fall.
    expect(worst(4, 8)).toBeLessThan(60);
    expect(worst(8.3, 8.4)).toBeLessThan(40);
    expect(worst(9, 9.8)).toBeLessThan(250);
    // Never past the engine: no reading above the peak.
    expect(Math.max(...out.map((o) => o.shown))).toBeLessThanOrEqual(7000);
  });
  it("is as calm as the low-pass on an idle that wanders", () => {
    let seed = 3;
    const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 160;
    const samples: number[] = [];
    for (let i = 0; i < 600; i++) samples.push(900 + noise());
    const f = createRpmFollower();
    let lp = samples[0];
    let worst = 0;
    for (const s of samples) {
      lp += (s - lp) * (1 - Math.exp(-1 / 60 / 0.25));
      worst = Math.max(worst, Math.abs(f.step(s, 1 / 60) - lp));
    }
    expect(worst).toBeLessThan(1);
  });
});

describe("listener volume", () => {
  it("is unity at 0, silent at -100, and rises to +12 dB at +100", () => {
    expect(volumeToGain(0)).toBe(1);
    expect(volumeToGain(-100)).toBe(0);
    expect(20 * Math.log10(volumeToGain(100))).toBeCloseTo(12, 6);
    expect(20 * Math.log10(volumeToGain(-50))).toBeCloseTo(-12.04, 1);
    expect(volumeToGain(250)).toBe(volumeToGain(100));
    expect(volumeToGain(Number.NaN)).toBe(1);
  });
});
