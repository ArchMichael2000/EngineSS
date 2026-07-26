import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG, FACTORY_PRESETS } from "./engineTypes";
import {
  analyzePcmReference,
  deriveTuningTargetFromAnalysis,
  findClosestTuningTarget,
  getEngineFamilyKey,
  validateCaptureAnalysis,
} from "./audioAnalysis";

function sineFixture(frequency: number, sampleRate = 8000, durationSec = 0.5): Float32Array {
  const length = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = Math.sin((Math.PI * 2 * frequency * i) / sampleRate) * 0.7;
  }
  return samples;
}

function noiseFixture(sampleRate = 8000, durationSec = 0.5): Float32Array {
  const length = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(length);
  let seed = 1234;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = ((seed / 4294967296) * 2 - 1) * 0.35;
  }
  return samples;
}

function pulseFixture(sampleRate = 8000, durationSec = 0.5): Float32Array {
  const length = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 500) {
    samples[i] = i % 1000 === 0 ? 0.95 : -0.75;
  }
  return samples;
}

function metadata(config = DEFAULT_ENGINE_CONFIG) {
  return {
    captureId: "capture-test",
    segmentType: "rpm-sweep" as const,
    perspective: "tailpipe" as const,
    rpmStart: 900,
    rpmEnd: 6500,
    load: 0.5,
    throttle: 0.8,
    engineConfig: config,
  };
}

describe("audio analysis", () => {
  it("creates valid capture analysis records for synthetic audio", () => {
    const analysis = analyzePcmReference(sineFixture(440), 8000, metadata(), {
      frameSize: 512,
      hopSize: 256,
      maxFrames: 24,
    });

    const validation = validateCaptureAnalysis(analysis);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(analysis.summary.frameCount).toBe(analysis.frames.length);
    expect(analysis.summary.spectralEnvelope).toHaveLength(16);
    expect(analysis.summary.orderEnergyCurve).toHaveLength(24);
    expect(analysis.summary.resonancePeaks.length).toBeGreaterThan(0);
    expect(analysis.summary.lowBandEnergy).toBeGreaterThanOrEqual(0);
    expect(analysis.summary.bassEnvelope.mean).toBeGreaterThanOrEqual(0);
  });

  it("finds a stable dominant frequency for a sine fixture", () => {
    const analysis = analyzePcmReference(sineFixture(440), 8000, metadata(), {
      frameSize: 512,
      hopSize: 256,
      maxFrames: 12,
    });

    expect(analysis.summary.dominantFrequencyMean).toBeGreaterThan(420);
    expect(analysis.summary.dominantFrequencyMean).toBeLessThan(460);
    expect(analysis.summary.spectralFlatnessMean).toBeLessThan(0.2);
  });

  it("separates noise texture from harmonic tone", () => {
    const sine = analyzePcmReference(sineFixture(440), 8000, metadata(), {
      frameSize: 512,
      hopSize: 256,
      maxFrames: 12,
    });
    const noise = analyzePcmReference(noiseFixture(), 8000, metadata(), {
      frameSize: 512,
      hopSize: 256,
      maxFrames: 12,
    });

    expect(noise.summary.spectralFlatnessMean).toBeGreaterThan(sine.summary.spectralFlatnessMean + 0.25);
    expect(noise.summary.zeroCrossingRateMean).toBeGreaterThan(sine.summary.zeroCrossingRateMean);
  });

  it("derives bounded tuning weights from pulse-heavy material", () => {
    const analysis = analyzePcmReference(pulseFixture(), 8000, metadata(FACTORY_PRESETS["inline-4-turbo"].config), {
      frameSize: 512,
      hopSize: 256,
      maxFrames: 12,
    });
    const target = deriveTuningTargetFromAnalysis(analysis);

    for (const value of Object.values(target.weights)) {
      expect(value).toBeGreaterThanOrEqual(0.35);
      expect(value).toBeLessThanOrEqual(1.85);
    }
    expect(target.weights.combustionEdge).toBeGreaterThan(0.7);
    expect(target.weights.lowOrderGain).toBeGreaterThan(0.35);
    expect(target.weights.bassShelf).toBeGreaterThan(0.35);
  });

  it("chooses the closest target by family, RPM, load, and perspective", () => {
    const v8Analysis = analyzePcmReference(sineFixture(220), 8000, metadata(DEFAULT_ENGINE_CONFIG), {
      frameSize: 512,
      hopSize: 256,
      maxFrames: 8,
    });
    const turboAnalysis = analyzePcmReference(sineFixture(520), 8000, metadata(FACTORY_PRESETS["inline-4-turbo"].config), {
      frameSize: 512,
      hopSize: 256,
      maxFrames: 8,
    });
    const v8Target = deriveTuningTargetFromAnalysis(v8Analysis);
    const turboTarget = deriveTuningTargetFromAnalysis(turboAnalysis);

    const closest = findClosestTuningTarget([turboTarget, v8Target], {
      engineFamilyKey: getEngineFamilyKey(DEFAULT_ENGINE_CONFIG),
      rpm: 3000,
      load: 0.45,
      perspective: "tailpipe",
    });

    expect(closest?.id).toBe(v8Target.id);
  });
});
