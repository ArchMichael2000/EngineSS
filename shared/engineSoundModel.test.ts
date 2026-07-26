import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG, FACTORY_PRESETS } from "./engineTypes";
import {
  buildEngineSoundAnalysis,
  buildEngineAcousticProfile,
  calculateEngineOrderFrequency,
  calculateFiringIntervals,
  calculateFourStrokeCycleRate,
  calculateFourStrokeFiringRate,
  dcBlockCoefficientForSoundProfile,
  generateEnginePcm,
  shapeClarityOutput,
} from "./engineSoundModel";
import { resolveLiveOutputGain } from "./realtimeAudioMix";

describe("engineSoundModel", () => {
  function goertzelPower(samples: Float32Array, sampleRate: number, frequency: number): number {
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const coeff = 2 * Math.cos(omega);
    let prev = 0;
    let prev2 = 0;

    for (let i = 0; i < samples.length; i++) {
      const value = samples[i] + coeff * prev - prev2;
      prev2 = prev;
      prev = value;
    }

    return prev2 * prev2 + prev * prev - coeff * prev * prev2;
  }

  function bandPower(samples: Float32Array, sampleRate: number, lowHz: number, highHz: number, stepHz = 10): number {
    let total = 0;
    for (let frequency = lowHz; frequency <= highHz; frequency += stepHz) {
      total += goertzelPower(samples, sampleRate, frequency);
    }
    return total;
  }

  function bandPowers(samples: Float32Array, sampleRate: number, lowHz: number, highHz: number, stepHz = 100): number[] {
    const powers: number[] = [];
    for (let frequency = lowHz; frequency <= highHz; frequency += stepHz) {
      powers.push(goertzelPower(samples, sampleRate, frequency));
    }
    return powers;
  }

  function tonalDominance(powers: number[]): number {
    const total = powers.reduce((sum, value) => sum + value, 0);
    return total > 0 ? Math.max(...powers) / total : 0;
  }

  function bandResidualRatio(powers: number[], retainedBins: number): number {
    const total = powers.reduce((sum, value) => sum + value, 0);
    const retained = [...powers].sort((a, b) => b - a).slice(0, retainedBins).reduce((sum, value) => sum + value, 0);
    return total > 0 ? (total - retained) / total : 0;
  }

  function meanAbsDelta(samples: Float32Array): number {
    let total = 0;
    for (let i = 1; i < samples.length; i++) total += Math.abs(samples[i] - samples[i - 1]);
    return total / Math.max(1, samples.length - 1);
  }

  function windowedMeanAbsDelta(samples: Float32Array, sampleRate: number, startSec: number, endSec: number): number {
    const start = Math.max(1, Math.floor(startSec * sampleRate));
    const end = Math.min(samples.length, Math.floor(endSec * sampleRate));
    let total = 0;
    for (let i = start; i < end; i++) total += Math.abs(samples[i] - samples[i - 1]);
    return total / Math.max(1, end - start);
  }

  function windowedRms(samples: Float32Array, sampleRate: number, startSec: number, endSec: number): number {
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const end = Math.min(samples.length, Math.floor(endSec * sampleRate));
    let energy = 0;
    for (let i = start; i < end; i++) energy += samples[i] * samples[i];
    return Math.sqrt(energy / Math.max(1, end - start));
  }

  function windowedPeak(samples: Float32Array, sampleRate: number, startSec: number, endSec: number): number {
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const end = Math.min(samples.length, Math.floor(endSec * sampleRate));
    let value = 0;
    for (let i = start; i < end; i++) value = Math.max(value, Math.abs(samples[i]));
    return value;
  }

  function windowedHalfWaveImbalance(samples: Float32Array, sampleRate: number, startSec: number, endSec: number): number {
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const end = Math.min(samples.length, Math.floor(endSec * sampleRate));
    let positive = 0;
    let negative = 0;
    for (let i = start; i < end; i++) {
      if (samples[i] >= 0) positive += samples[i];
      else negative -= samples[i];
    }
    const total = positive + negative;
    return total > 0 ? Math.abs(positive - negative) / total : 0;
  }

  function rms(samples: Float32Array): number {
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    return Math.sqrt(energy / samples.length);
  }

  function peak(samples: Float32Array): number {
    let value = 0;
    for (const sample of samples) value = Math.max(value, Math.abs(sample));
    return value;
  }

  function allFinite(samples: Float32Array): boolean {
    for (const sample of samples) {
      if (!Number.isFinite(sample)) return false;
    }
    return true;
  }

  it("uses mechanically correct four-stroke even-fire spacing", () => {
    const intervals = calculateFiringIntervals(8, "even-fire", "v");
    expect(intervals).toHaveLength(8);
    expect(intervals.every((value) => value === 90)).toBe(true);
    expect(intervals.reduce((sum, value) => sum + value, 0)).toBeCloseTo(720, 5);
  });

  it("normalizes odd-fire intervals to one 720-degree cycle", () => {
    const intervals = calculateFiringIntervals(5, "odd-fire", "inline");
    expect(intervals).toHaveLength(5);
    expect(new Set(intervals.map((value) => Math.round(value))).size).toBeGreaterThan(1);
    expect(intervals.reduce((sum, value) => sum + value, 0)).toBeCloseTo(720, 5);
  });

  it("keeps a cross-plane V8 globally even while exposing bank-to-bank rhythm", () => {
    const analysis = buildEngineSoundAnalysis(DEFAULT_ENGINE_CONFIG);
    expect(analysis.events.map((event) => event.intervalDeg)).toEqual(Array(8).fill(90));
    expect(new Set(analysis.events.map((event) => event.bankIndex)).size).toBe(2);
    expect(analysis.events.some((event) => event.pan < 0)).toBe(true);
    expect(analysis.events.some((event) => event.pan > 0)).toBe(true);
  });

  it("adds bounded per-cylinder timbre identity for non-repetitive Clarity pulses", () => {
    const analysis = buildEngineSoundAnalysis(FACTORY_PRESETS["v8-crossplane"].config);
    const resonanceValues = analysis.events.map((event) => event.resonanceSkew);
    const throatValues = analysis.events.map((event) => event.throatBias);
    const blowdownValues = analysis.events.map((event) => event.blowdownBias);

    expect(new Set(resonanceValues.map((value) => value.toFixed(3))).size).toBeGreaterThan(3);
    expect(new Set(throatValues.map((value) => value.toFixed(3))).size).toBeGreaterThan(3);
    expect(new Set(blowdownValues.map((value) => value.toFixed(3))).size).toBeGreaterThan(3);
    expect(Math.min(...resonanceValues)).toBeGreaterThan(0.90);
    expect(Math.max(...resonanceValues)).toBeLessThan(1.10);
    expect(Math.min(...throatValues)).toBeGreaterThan(0.80);
    expect(Math.max(...blowdownValues)).toBeLessThan(1.24);
  });

  it("maps four-stroke firing rate to combustion order", () => {
    expect(calculateFourStrokeCycleRate(6000)).toBeCloseTo(50, 5);
    expect(calculateFourStrokeFiringRate(6000, 8)).toBeCloseTo(400, 5);
    expect(calculateEngineOrderFrequency(6000, 4)).toBeCloseTo(400, 5);
  });

  it("derives per-bank acoustic roughness from the 720-degree pulse pattern", () => {
    const crossPlane = buildEngineAcousticProfile(FACTORY_PRESETS["v8-crossplane"].config, 3000);
    const flatPlane = buildEngineAcousticProfile(FACTORY_PRESETS["v8-flatplane"].config, 3000);

    expect(crossPlane.cycleHz).toBeCloseTo(25, 5);
    expect(crossPlane.bankRoughness).toBeGreaterThan(flatPlane.bankRoughness + 0.05);
    expect(crossPlane.lowOrderEnergy).toBeGreaterThan(flatPlane.lowOrderEnergy);
    expect(crossPlane.orderSpectrum).toHaveLength(32);
  });

  it("does not make perceived pitch rise monotonically with cylinder count", () => {
    const profiles = [
      FACTORY_PRESETS["inline-4-turbo"].config,
      FACTORY_PRESETS["inline-6"].config,
      FACTORY_PRESETS["v8-crossplane"].config,
      FACTORY_PRESETS["v10"].config,
      FACTORY_PRESETS["v12"].config,
    ].map((config) => buildEngineAcousticProfile(config, 3500).perceivedPitchIndex);

    const strictlyIncreasing = profiles.every((value, index) => index === 0 || value > profiles[index - 1]);
    expect(strictlyIncreasing).toBe(false);
    expect(buildEngineAcousticProfile(FACTORY_PRESETS["v12"].config, 3500).perceivedPitchIndex)
      .toBeLessThan(buildEngineAcousticProfile(FACTORY_PRESETS["v8-flatplane"].config, 3500).perceivedPitchIndex);
  });

  it("returns stable acoustic profile defaults for every factory preset", () => {
    for (const preset of Object.values(FACTORY_PRESETS)) {
      const profile = buildEngineAcousticProfile(preset.config, 2400);
      expect(profile.cycleHz).toBeCloseTo(20, 5);
      expect(profile.resonanceModes).toHaveLength(4);
      expect(profile.geometry.exhaustLengthCm).toBeGreaterThan(80);
      expect(profile.perceivedPitchIndex).toBeGreaterThan(0.5);
      expect(profile.perceivedPitchIndex).toBeLessThan(1.5);
    }
  });

  it("keeps the Clarity output shaper linear below the headroom knee", () => {
    expect(shapeClarityOutput(0)).toBe(0);
    expect(shapeClarityOutput(0.25)).toBeCloseTo(0.25, 6);
    expect(shapeClarityOutput(-0.60)).toBeCloseTo(-0.60, 6);
    expect(Math.abs(shapeClarityOutput(0.95))).toBeLessThan(0.95);
    expect(Math.abs(shapeClarityOutput(3))).toBeLessThanOrEqual(1);
  });

  it("uses a gentler clarity-family DC blocker to preserve low body response", () => {
    expect(dcBlockCoefficientForSoundProfile("v10")).toBeGreaterThan(dcBlockCoefficientForSoundProfile("v8"));
    expect(dcBlockCoefficientForSoundProfile("v11")).toBe(dcBlockCoefficientForSoundProfile("v10"));
    expect(dcBlockCoefficientForSoundProfile("v12")).toBe(dcBlockCoefficientForSoundProfile("v10"));
    expect(dcBlockCoefficientForSoundProfile("v13")).toBe(dcBlockCoefficientForSoundProfile("v10"));
    expect(dcBlockCoefficientForSoundProfile("v14")).toBe(dcBlockCoefficientForSoundProfile("v10"));
    expect(dcBlockCoefficientForSoundProfile("v15")).toBe(dcBlockCoefficientForSoundProfile("v10"));
    expect(dcBlockCoefficientForSoundProfile("v9")).toBeGreaterThan(0.999);
    expect(dcBlockCoefficientForSoundProfile("v8")).toBe(0.995);
    expect(dcBlockCoefficientForSoundProfile(undefined)).toBe(dcBlockCoefficientForSoundProfile("v16"));
  });

  it("renders bounded, non-silent stereo PCM", () => {
    const { left, right, sampleRate } = generateEnginePcm(DEFAULT_ENGINE_CONFIG, {
      durationSec: 0.25,
      sampleRate: 22050,
      normalize: true,
    });

    expect(sampleRate).toBe(22050);
    expect(left.length).toBe(5512);
    expect(right.length).toBe(5512);

    let peak = 0;
    let energy = 0;
    let stereoDifference = 0;
    for (let i = 0; i < left.length; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      energy += left[i] * left[i] + right[i] * right[i];
      stereoDifference += Math.abs(left[i] - right[i]);
    }

    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(0.951);
    expect(energy).toBeGreaterThan(1);
    expect(stereoDifference).toBeGreaterThan(0.1);
  });

  it("renders saved versioned sound profiles and legacy aliases", () => {
    for (const soundProfile of ["v16", "v15", "v14", "v13", "v12", "v11", "v10", "v9", "v8", "v0", "clarity", "clean", "baseline"] as const) {
      const { left, right } = generateEnginePcm(
        {
          ...DEFAULT_ENGINE_CONFIG,
          soundProfile,
        },
        {
          durationSec: 0.12,
          sampleRate: 22050,
          normalize: false,
        },
      );

      let peak = 0;
      let energy = 0;
      for (let i = 0; i < left.length; i++) {
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        energy += left[i] * left[i] + right[i] * right[i];
      }

      expect(peak).toBeGreaterThan(0.02);
      expect(peak).toBeLessThanOrEqual(1);
      expect(energy).toBeGreaterThan(0.01);
    }
  });

  it("renders bounded versioned PCM with capture-derived tuning weights", () => {
    for (const soundProfile of ["v10", "v9", "v8", "v0"] as const) {
      const { left, right } = generateEnginePcm(
        {
          ...DEFAULT_ENGINE_CONFIG,
          soundProfile,
          soundTuning: {
            sourceCaptureId: "capture-test",
            analysisId: "analysis-test",
            targetId: "target-test",
            engineFamilyKey: "v:8cyl:cross-plane:sport:single-throttle-body:na",
            createdAt: new Date("2026-07-24T00:00:00Z").toISOString(),
            weights: {
              combustionEdge: 1.45,
              exhaustFormantShift: 0.92,
              exhaustBrightness: 1.32,
              orderHarmonicGain: 1.22,
              intakeTexture: 0.88,
              turboWhoosh: 1,
              turboTone: 1,
              superchargerWhine: 1,
              muffling: 0.82,
              clarity: 1.28,
              lowOrderGain: 1.24,
              bodyResonanceGain: 1.18,
              bassShelf: 1.16,
              pulseDensitySmoothing: 1.05,
              spectralTilt: 1.08,
            },
          },
        },
        {
          durationSec: 0.16,
          sampleRate: 22050,
          normalize: false,
        },
      );

      let peak = 0;
      let energy = 0;
      for (let i = 0; i < left.length; i++) {
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        energy += left[i] * left[i] + right[i] * right[i];
      }

      expect(peak).toBeGreaterThan(0.02);
      expect(peak).toBeLessThanOrEqual(1);
      expect(energy).toBeGreaterThan(0.01);
    }
  });

  it("uses clarity profile to add broad dry exhaust presence while retaining depth", () => {
    const baseConfig = {
      ...FACTORY_PRESETS["v8-crossplane"].config,
      quick: {
        ...FACTORY_PRESETS["v8-crossplane"].config.quick,
        exhaustCharacter: "sport" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...baseConfig,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.34,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3200,
        endRpm: 3200,
        throttle: 0.58,
        load: 0.70,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...baseConfig,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.34,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3200,
        endRpm: 3200,
        throttle: 0.58,
        load: 0.70,
        normalize: false,
      },
    );

    const cleanPresence = bandPower(clean.left, clean.sampleRate, 1600, 5200, 80);
    const clarityPresence = bandPower(clarity.left, clarity.sampleRate, 1600, 5200, 80);
    const cleanLowBody = bandPower(clean.left, clean.sampleRate, 45, 520, 10);
    const clarityLowBody = bandPower(clarity.left, clarity.sampleRate, 45, 520, 10);
    let maxPresenceBin = 0;
    for (let frequency = 1600; frequency <= 5200; frequency += 80) {
      maxPresenceBin = Math.max(maxPresenceBin, goertzelPower(clarity.left, clarity.sampleRate, frequency));
    }

    expect(clarityPresence).toBeGreaterThan(cleanPresence * 1.08);
    expect(clarityLowBody).toBeGreaterThan(cleanLowBody * 0.72);
    expect(maxPresenceBin / clarityPresence).toBeLessThan(0.72);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("adds event-gated air texture instead of a single filtered bright band", () => {
    const config = {
      ...FACTORY_PRESETS["v8-crossplane"].config,
      quick: {
        ...FACTORY_PRESETS["v8-crossplane"].config.quick,
        exhaustCharacter: "race" as const,
      },
      advanced: {
        ...FACTORY_PRESETS["v8-crossplane"].config.advanced,
        exhaustRouting: "open-headers" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...config,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.36,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3600,
        endRpm: 3600,
        throttle: 0.70,
        load: 0.78,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...config,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.36,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3600,
        endRpm: 3600,
        throttle: 0.70,
        load: 0.78,
        normalize: false,
      },
    );

    const cleanBands = bandPowers(clean.left, clean.sampleRate, 2400, 7600, 130);
    const clarityBands = bandPowers(clarity.left, clarity.sampleRate, 2400, 7600, 130);
    const cleanUpper = cleanBands.reduce((sum, value) => sum + value, 0);
    const clarityUpper = clarityBands.reduce((sum, value) => sum + value, 0);

    expect(clarityUpper).toBeGreaterThan(cleanUpper * 1.04);
    expect(tonalDominance(clarityBands)).toBeLessThan(Math.max(0.68, tonalDominance(cleanBands) * 1.08));
    expect(meanAbsDelta(clarity.left)).toBeGreaterThan(meanAbsDelta(clean.left) * 1.03);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("uses pressure-edge transients to sharpen Clarity attacks without tonal collapse", () => {
    const config = {
      ...FACTORY_PRESETS["v8-crossplane"].config,
      quick: {
        ...FACTORY_PRESETS["v8-crossplane"].config.quick,
        exhaustCharacter: "race" as const,
      },
      advanced: {
        ...FACTORY_PRESETS["v8-crossplane"].config.advanced,
        exhaustRouting: "open-headers" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...config,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.34,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3000,
        endRpm: 3000,
        throttle: 0.72,
        load: 0.82,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...config,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.34,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3000,
        endRpm: 3000,
        throttle: 0.72,
        load: 0.82,
        normalize: false,
      },
    );

    const cleanAttack = windowedMeanAbsDelta(clean.left, clean.sampleRate, 0.006, 0.052);
    const clarityAttack = windowedMeanAbsDelta(clarity.left, clarity.sampleRate, 0.006, 0.052);
    const cleanTail = windowedMeanAbsDelta(clean.left, clean.sampleRate, 0.13, 0.30);
    const clarityTail = windowedMeanAbsDelta(clarity.left, clarity.sampleRate, 0.13, 0.30);
    const clarityBands = bandPowers(clarity.left, clarity.sampleRate, 3000, 8500, 160);

    expect(clarityAttack).toBeGreaterThan(cleanAttack * 1.045);
    expect(clarityAttack).toBeGreaterThan(clarityTail * 0.90);
    expect(tonalDominance(clarityBands)).toBeLessThan(0.66);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("pulse-conditions Clarity support layers while preserving low body energy", () => {
    const config = {
      ...FACTORY_PRESETS["v12"].config,
      quick: {
        ...FACTORY_PRESETS["v12"].config.quick,
        exhaustCharacter: "race" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...config,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.42,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3400,
        endRpm: 3400,
        throttle: 0.66,
        load: 0.76,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...config,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.42,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3400,
        endRpm: 3400,
        throttle: 0.66,
        load: 0.76,
        normalize: false,
      },
    );

    const cleanAttackTexture = windowedMeanAbsDelta(clean.left, clean.sampleRate, 0.006, 0.060);
    const clarityAttackTexture = windowedMeanAbsDelta(clarity.left, clarity.sampleRate, 0.006, 0.060);
    const cleanSustainTexture = windowedMeanAbsDelta(clean.left, clean.sampleRate, 0.18, 0.36);
    const claritySustainTexture = windowedMeanAbsDelta(clarity.left, clarity.sampleRate, 0.18, 0.36);
    const cleanLowBody = bandPower(clean.left, clean.sampleRate, 45, 520, 10);
    const clarityLowBody = bandPower(clarity.left, clarity.sampleRate, 45, 520, 10);

    expect(clarityAttackTexture).toBeGreaterThan(claritySustainTexture * 0.92);
    expect(windowedRms(clarity.left, clarity.sampleRate, 0.18, 0.36)).toBeGreaterThan(0.003);
    expect(clarityLowBody).toBeGreaterThan(cleanLowBody * 0.58);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("spreads Clarity pipe energy with per-pulse chirp and throat roughness", () => {
    const config = {
      ...FACTORY_PRESETS["v8-flatplane"].config,
      quick: {
        ...FACTORY_PRESETS["v8-flatplane"].config.quick,
        exhaustCharacter: "race" as const,
      },
      advanced: {
        ...FACTORY_PRESETS["v8-flatplane"].config.advanced,
        exhaustRouting: "open-headers" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...config,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.36,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 4200,
        endRpm: 4200,
        throttle: 0.68,
        load: 0.72,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...config,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.36,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 4200,
        endRpm: 4200,
        throttle: 0.68,
        load: 0.72,
        normalize: false,
      },
    );

    const cleanPipeBands = bandPowers(clean.left, clean.sampleRate, 900, 5200, 120);
    const clarityPipeBands = bandPowers(clarity.left, clarity.sampleRate, 900, 5200, 120);
    const cleanPipePower = cleanPipeBands.reduce((sum, value) => sum + value, 0);
    const clarityPipePower = clarityPipeBands.reduce((sum, value) => sum + value, 0);

    expect(clarityPipePower).toBeGreaterThan(cleanPipePower * 0.92);
    expect(tonalDominance(clarityPipeBands)).toBeLessThan(Math.max(0.64, tonalDominance(cleanPipeBands) * 1.02));
    expect(meanAbsDelta(clarity.left)).toBeGreaterThan(meanAbsDelta(clean.left) * 1.02);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("adds asymmetric blowdown bark without clipping the Clarity profile", () => {
    const config = {
      ...FACTORY_PRESETS["v8-crossplane"].config,
      quick: {
        ...FACTORY_PRESETS["v8-crossplane"].config.quick,
        exhaustCharacter: "race" as const,
      },
      advanced: {
        ...FACTORY_PRESETS["v8-crossplane"].config.advanced,
        exhaustRouting: "open-headers" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...config,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.34,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 2850,
        endRpm: 2850,
        throttle: 0.74,
        load: 0.84,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...config,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.34,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 2850,
        endRpm: 2850,
        throttle: 0.74,
        load: 0.84,
        normalize: false,
      },
    );

    const cleanCrest = windowedPeak(clean.left, clean.sampleRate, 0.006, 0.055) / windowedRms(clean.left, clean.sampleRate, 0.006, 0.055);
    const clarityCrest = windowedPeak(clarity.left, clarity.sampleRate, 0.006, 0.055) / windowedRms(clarity.left, clarity.sampleRate, 0.006, 0.055);
    const clarityImbalance = windowedHalfWaveImbalance(clarity.left, clarity.sampleRate, 0.006, 0.055);
    const clarityBarkBands = bandPowers(clarity.left, clarity.sampleRate, 1100, 6200, 140);

    expect(clarityCrest).toBeGreaterThan(cleanCrest * 1.01);
    expect(clarityImbalance).toBeGreaterThan(0.015);
    expect(tonalDominance(clarityBarkBands)).toBeLessThan(0.66);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("adds broad near-field exhaust radiation without continuous tonal wash", () => {
    const config = {
      ...FACTORY_PRESETS["v8-crossplane"].config,
      quick: {
        ...FACTORY_PRESETS["v8-crossplane"].config.quick,
        exhaustCharacter: "race" as const,
      },
      advanced: {
        ...FACTORY_PRESETS["v8-crossplane"].config.advanced,
        exhaustRouting: "open-headers" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...config,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.36,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3000,
        endRpm: 3000,
        throttle: 0.76,
        load: 0.84,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...config,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.36,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3000,
        endRpm: 3000,
        throttle: 0.76,
        load: 0.84,
        normalize: false,
      },
    );

    const cleanRadiationBands = bandPowers(clean.left, clean.sampleRate, 4200, 9600, 180);
    const clarityRadiationBands = bandPowers(clarity.left, clarity.sampleRate, 4200, 9600, 180);
    const cleanRadiation = cleanRadiationBands.reduce((sum, value) => sum + value, 0);
    const clarityRadiation = clarityRadiationBands.reduce((sum, value) => sum + value, 0);
    const clarityLowBody = bandPower(clarity.left, clarity.sampleRate, 45, 520, 10);

    expect(clarityRadiation).toBeGreaterThan(cleanRadiation * 1.02);
    expect(tonalDominance(clarityRadiationBands)).toBeLessThan(0.62);
    expect(clarityLowBody).toBeGreaterThan(1000);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("adds Clarity mechanical tick texture without a steady valve alarm", () => {
    const config = {
      ...FACTORY_PRESETS["inline-6"].config,
      quick: {
        ...FACTORY_PRESETS["inline-6"].config.quick,
        exhaustCharacter: "sport" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...config,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.36,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 2800,
        endRpm: 2800,
        throttle: 0.70,
        load: 0.76,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...config,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.36,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 2800,
        endRpm: 2800,
        throttle: 0.70,
        load: 0.76,
        normalize: false,
      },
    );

    const cleanMechanicalBands = bandPowers(clean.left, clean.sampleRate, 1800, 7600, 160);
    const clarityMechanicalBands = bandPowers(clarity.left, clarity.sampleRate, 1800, 7600, 160);
    const cleanMechanical = cleanMechanicalBands.reduce((sum, value) => sum + value, 0);
    const clarityMechanical = clarityMechanicalBands.reduce((sum, value) => sum + value, 0);
    const cleanAttackTexture = windowedMeanAbsDelta(clean.left, clean.sampleRate, 0.006, 0.070);
    const clarityAttackTexture = windowedMeanAbsDelta(clarity.left, clarity.sampleRate, 0.006, 0.070);

    expect(clarityMechanical).toBeGreaterThan(cleanMechanical * 1.01);
    expect(clarityAttackTexture).toBeGreaterThan(cleanAttackTexture * 1.01);
    expect(tonalDominance(clarityMechanicalBands)).toBeLessThan(0.63);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("preserves Clarity transient crest through the transparent output shaper", () => {
    const config = {
      ...FACTORY_PRESETS["v8-crossplane"].config,
      quick: {
        ...FACTORY_PRESETS["v8-crossplane"].config.quick,
        exhaustCharacter: "race" as const,
      },
      advanced: {
        ...FACTORY_PRESETS["v8-crossplane"].config.advanced,
        exhaustRouting: "open-headers" as const,
      },
    };
    const clean = generateEnginePcm(
      {
        ...config,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.32,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3100,
        endRpm: 3100,
        throttle: 0.78,
        load: 0.86,
        normalize: false,
      },
    );
    const clarity = generateEnginePcm(
      {
        ...config,
        soundProfile: "clarity" as const,
      },
      {
        durationSec: 0.32,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3100,
        endRpm: 3100,
        throttle: 0.78,
        load: 0.86,
        normalize: false,
      },
    );

    const cleanCrest = windowedPeak(clean.left, clean.sampleRate, 0.006, 0.080) / windowedRms(clean.left, clean.sampleRate, 0.006, 0.080);
    const clarityCrest = windowedPeak(clarity.left, clarity.sampleRate, 0.006, 0.080) / windowedRms(clarity.left, clarity.sampleRate, 0.006, 0.080);

    expect(clarityCrest).toBeGreaterThan(cleanCrest * 1.01);
    expect(peak(clarity.left)).toBeLessThanOrEqual(1);
  });

  it("adds Clarity-only open-header reflection bark after the initial hit", () => {
    const stockConfig = {
      ...FACTORY_PRESETS["v8-crossplane"].config,
      soundProfile: "clarity" as const,
      quick: {
        ...FACTORY_PRESETS["v8-crossplane"].config.quick,
        exhaustCharacter: "sport" as const,
      },
      advanced: {
        ...FACTORY_PRESETS["v8-crossplane"].config.advanced,
        exhaustRouting: "single" as const,
      },
    };
    const openHeaderConfig = {
      ...stockConfig,
      advanced: {
        ...stockConfig.advanced,
        exhaustRouting: "open-headers" as const,
      },
    };
    const cleanOpenHeaders = generateEnginePcm(
      {
        ...openHeaderConfig,
        soundProfile: "clean" as const,
      },
      {
        durationSec: 0.34,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 2600,
        endRpm: 2600,
        throttle: 0.62,
        load: 0.78,
        normalize: false,
      },
    );
    const stock = generateEnginePcm(stockConfig, {
      durationSec: 0.34,
      sampleRate: 22050,
      profile: "steady",
      startRpm: 2600,
      endRpm: 2600,
      throttle: 0.62,
      load: 0.78,
      normalize: false,
    });
    const openHeaders = generateEnginePcm(openHeaderConfig, {
      durationSec: 0.34,
      sampleRate: 22050,
      profile: "steady",
      startRpm: 2600,
      endRpm: 2600,
      throttle: 0.62,
      load: 0.78,
      normalize: false,
    });

    const stockReflectionTexture = windowedMeanAbsDelta(stock.left, stock.sampleRate, 0.045, 0.16);
    const openReflectionTexture = windowedMeanAbsDelta(openHeaders.left, openHeaders.sampleRate, 0.045, 0.16);
    const cleanReflectionTexture = windowedMeanAbsDelta(cleanOpenHeaders.left, cleanOpenHeaders.sampleRate, 0.045, 0.16);

    expect(openReflectionTexture).toBeGreaterThan(stockReflectionTexture * 1.02);
    expect(openReflectionTexture).toBeGreaterThan(cleanReflectionTexture * 1.04);
    expect(peak(openHeaders.left)).toBeLessThanOrEqual(1);
  });

  it("keeps flat-plane V8 clean profile from collapsing into one upper-mid alarm band", () => {
    const flatPlaneConfig = {
      ...FACTORY_PRESETS["v8-flatplane"].config,
      soundProfile: "clean" as const,
    };
    const { left, sampleRate } = generateEnginePcm(flatPlaneConfig, {
      durationSec: 0.3,
      sampleRate: 22050,
      profile: "steady",
      startRpm: 2600,
      endRpm: 2600,
      throttle: 0.35,
      load: 0.45,
      normalize: false,
    });

    let highBandPower = 0;
    let maxHighBandPower = 0;
    for (let frequency = 600; frequency <= 1800; frequency += 50) {
      const power = goertzelPower(left, sampleRate, frequency);
      highBandPower += power;
      maxHighBandPower = Math.max(maxHighBandPower, power);
    }

    expect(maxHighBandPower / highBandPower).toBeLessThan(0.8);
  });

  it("adds cross-plane V8 low-band depth without clipping", () => {
    const crossPlane = generateEnginePcm(
      {
        ...FACTORY_PRESETS["v8-crossplane"].config,
        soundProfile: "clean",
      },
      {
        durationSec: 0.32,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 2400,
        endRpm: 2400,
        throttle: 0.52,
        load: 0.72,
        normalize: false,
      },
    );
    const flatPlane = generateEnginePcm(
      {
        ...FACTORY_PRESETS["v8-flatplane"].config,
        soundProfile: "clean",
      },
      {
        durationSec: 0.32,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 2400,
        endRpm: 2400,
        throttle: 0.52,
        load: 0.72,
        normalize: false,
      },
    );

    const crossLow = bandPower(crossPlane.left, crossPlane.sampleRate, 45, 180, 5);
    const flatLow = bandPower(flatPlane.left, flatPlane.sampleRate, 45, 180, 5);

    expect(crossLow).toBeGreaterThan(flatLow * 1.05);
    expect(peak(crossPlane.left)).toBeLessThanOrEqual(1);
  });

  it("keeps V12 smoother than cross-plane V8 while retaining body energy", () => {
    const v12 = generateEnginePcm(FACTORY_PRESETS["v12"].config, {
      durationSec: 0.28,
      sampleRate: 22050,
      profile: "steady",
      startRpm: 3200,
      endRpm: 3200,
      throttle: 0.58,
      load: 0.65,
      normalize: false,
    });
    const v12Profile = buildEngineAcousticProfile(FACTORY_PRESETS["v12"].config, 3200);
    const v8Profile = buildEngineAcousticProfile(FACTORY_PRESETS["v8-crossplane"].config, 3200);
    const v12Crest = peak(v12.left) / Math.max(0.00001, rms(v12.left));
    const v12Low = bandPower(v12.left, v12.sampleRate, 45, 180, 5);
    const v12Body = bandPower(v12.left, v12.sampleRate, 180, 520, 10);
    const v12Presence = bandPower(v12.left, v12.sampleRate, 900, 2400, 25);

    expect(v12Profile.pulseDensitySmoothing).toBeGreaterThan(v8Profile.pulseDensitySmoothing);
    expect(v12Profile.bankRoughness).toBeLessThan(v8Profile.bankRoughness);
    expect(v12Crest).toBeLessThan(5);
    expect(v12Low + v12Body).toBeGreaterThan(v12Presence * 0.02);
  });

  it("keeps Clarity V8 output alive above 6000 RPM", () => {
    const redline = generateEnginePcm(
      {
        ...FACTORY_PRESETS["v8-crossplane"].config,
        soundProfile: "clarity",
      },
      {
        durationSec: 0.58,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 6150,
        endRpm: 6150,
        throttle: 0.88,
        load: 0.82,
        normalize: false,
      },
    );

    const earlyRms = windowedRms(redline.left, redline.sampleRate, 0.04, 0.18);
    const tailRms = windowedRms(redline.left, redline.sampleRate, 0.38, 0.56);

    expect(allFinite(redline.left)).toBe(true);
    expect(allFinite(redline.right)).toBe(true);
    expect(tailRms).toBeGreaterThan(0.004);
    expect(tailRms).toBeGreaterThan(earlyRms * 0.30);
    expect(peak(redline.left)).toBeLessThanOrEqual(1);
  });

  it("renders non-silent Clarity V12 output for live speaker parity", () => {
    const v12 = generateEnginePcm(
      {
        ...FACTORY_PRESETS["v12"].config,
        soundProfile: "clarity",
      },
      {
        durationSec: 0.42,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 2200,
        endRpm: 2200,
        throttle: 0.42,
        load: 0.52,
        normalize: false,
      },
    );

    expect(allFinite(v12.left)).toBe(true);
    expect(allFinite(v12.right)).toBe(true);
    expect(windowedRms(v12.left, v12.sampleRate, 0.12, 0.40)).toBeGreaterThan(0.0035);
    expect(peak(v12.left)).toBeLessThanOrEqual(1);
  });

  it("keeps turbo renders from becoming one pure whistle band", () => {
    const { left, sampleRate } = generateEnginePcm(
      {
        ...FACTORY_PRESETS["inline-4-turbo"].config,
        soundProfile: "clean",
      },
      {
        durationSec: 0.3,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 4700,
        endRpm: 4700,
        throttle: 0.85,
        load: 0.8,
        normalize: false,
      },
    );

    let highBandPower = 0;
    let maxHighBandPower = 0;
    for (let frequency = 1500; frequency <= 8200; frequency += 100) {
      const power = goertzelPower(left, sampleRate, frequency);
      highBandPower += power;
      maxHighBandPower = Math.max(maxHighBandPower, power);
    }

    expect(maxHighBandPower / highBandPower).toBeLessThan(0.62);
  });

  it("reduces v12 high-rpm intake wash without muting the engine", () => {
    function renderAirflowCandidate(soundProfile: "v11" | "v12") {
      return generateEnginePcm(
        {
          ...FACTORY_PRESETS["v8-crossplane"].config,
          soundProfile,
          seed: 12,
          quick: {
            ...FACTORY_PRESETS["v8-crossplane"].config.quick,
            exhaustCharacter: "stock",
            redline: 8500,
          },
        },
        {
          durationSec: 0.32,
          sampleRate: 22050,
          profile: "steady",
          startRpm: 7200,
          endRpm: 7200,
          throttle: 0.78,
          load: 0.22,
          normalize: false,
        },
      );
    }

    const v11 = renderAirflowCandidate("v11");
    const v12 = renderAirflowCandidate("v12");
    const v11WashRatio = bandPower(v11.left, v11.sampleRate, 3500, 9000, 150) / Math.max(1e-9, bandPower(v11.left, v11.sampleRate, 80, 1200, 40));
    const v12WashRatio = bandPower(v12.left, v12.sampleRate, 3500, 9000, 150) / Math.max(1e-9, bandPower(v12.left, v12.sampleRate, 80, 1200, 40));

    expect(rms(v12.left)).toBeGreaterThan(0.006);
    expect(v12WashRatio).toBeLessThan(v11WashRatio * 0.92);
  });

  it("keeps v13 high-rpm clarity from becoming continuous speaker airflow", () => {
    function renderAirflowCandidate(soundProfile: "v12" | "v13", rpm: number) {
      return generateEnginePcm(
        {
          ...FACTORY_PRESETS["v8-crossplane"].config,
          soundProfile,
          seed: 12,
          quick: {
            ...FACTORY_PRESETS["v8-crossplane"].config.quick,
            exhaustCharacter: "stock",
            redline: 8500,
          },
        },
        {
          durationSec: 0.36,
          sampleRate: 22050,
          profile: "steady",
          startRpm: rpm,
          endRpm: rpm,
          throttle: 0.78,
          load: 0.22,
          normalize: false,
        },
      );
    }

    const v12High = renderAirflowCandidate("v12", 7200);
    const v13Low = renderAirflowCandidate("v13", 3600);
    const v13High = renderAirflowCandidate("v13", 7200);
    const v12HighAir = bandPower(v12High.left, v12High.sampleRate, 4200, 9800, 160);
    const v13LowAir = bandPower(v13Low.left, v13Low.sampleRate, 4200, 9800, 160);
    const v13HighAir = bandPower(v13High.left, v13High.sampleRate, 4200, 9800, 160);
    const v13Body = bandPower(v13High.left, v13High.sampleRate, 60, 1200, 40);

    expect(rms(v13High.left)).toBeGreaterThan(0.006);
    expect(v13HighAir).toBeLessThan(v12HighAir * 0.56);
    expect(v13HighAir).toBeLessThan(v13LowAir * 1.85);
    expect(v13HighAir / Math.max(1e-9, v13Body)).toBeLessThan(0.00012);
  });

  it("keeps v14 high-rpm clarity free of rising TV-static wash", () => {
    function renderStaticCandidate(soundProfile: "v12" | "v13" | "v14", rpm: number) {
      return generateEnginePcm(
        {
          ...FACTORY_PRESETS["v8-crossplane"].config,
          soundProfile,
          seed: 17,
          quick: {
            ...FACTORY_PRESETS["v8-crossplane"].config.quick,
            exhaustCharacter: "stock",
            redline: 8500,
          },
        },
        {
          durationSec: 0.36,
          sampleRate: 22050,
          profile: "steady",
          startRpm: rpm,
          endRpm: rpm,
          throttle: 0.78,
          load: 0.22,
          normalize: false,
        },
      );
    }

    const v12High = renderStaticCandidate("v12", 7200);
    const v13High = renderStaticCandidate("v13", 7200);
    const v14Low = renderStaticCandidate("v14", 3600);
    const v14High = renderStaticCandidate("v14", 7200);
    const v12HighPowers = bandPowers(v12High.left, v12High.sampleRate, 4200, 9800, 160);
    const v14HighPowers = bandPowers(v14High.left, v14High.sampleRate, 4200, 9800, 160);
    const v12HighAir = v12HighPowers.reduce((sum, value) => sum + value, 0);
    const v14HighAir = v14HighPowers.reduce((sum, value) => sum + value, 0);
    const v14LowAir = bandPower(v14Low.left, v14Low.sampleRate, 4200, 9800, 160);
    const v12Body = bandPower(v12High.left, v12High.sampleRate, 60, 1200, 40);
    const v14LowBody = bandPower(v14Low.left, v14Low.sampleRate, 60, 1200, 40);
    const v14Body = bandPower(v14High.left, v14High.sampleRate, 60, 1200, 40);

    expect(rms(v14High.left)).toBeGreaterThan(0.006);
    expect(v14HighAir).toBeLessThan(v12HighAir * 0.55);
    expect(v14HighAir / Math.max(1e-9, v14Body)).toBeLessThan(v12HighAir / Math.max(1e-9, v12Body) * 0.62);
    expect(v14HighAir / Math.max(1e-9, v14Body)).toBeLessThan(v14LowAir / Math.max(1e-9, v14LowBody));
    expect(bandResidualRatio(v14HighPowers, 12)).toBeLessThan(bandResidualRatio(v12HighPowers, 12) * 0.94);
    expect(meanAbsDelta(v14High.left)).toBeLessThan(meanAbsDelta(v13High.left) * 0.98);
  });

  it("keeps v15 cleaner than v14 by removing residual air-texture layers", () => {
    function renderStaticCandidate(soundProfile: "v14" | "v15", rpm: number) {
      return generateEnginePcm(
        {
          ...FACTORY_PRESETS["v8-crossplane"].config,
          soundProfile,
          seed: 17,
          quick: {
            ...FACTORY_PRESETS["v8-crossplane"].config.quick,
            exhaustCharacter: "stock",
            redline: 8500,
          },
        },
        {
          durationSec: 0.36,
          sampleRate: 22050,
          profile: "steady",
          startRpm: rpm,
          endRpm: rpm,
          throttle: 0.78,
          load: 0.22,
          normalize: false,
        },
      );
    }

    const v14High = renderStaticCandidate("v14", 7200);
    const v15High = renderStaticCandidate("v15", 7200);
    const v14HighPowers = bandPowers(v14High.left, v14High.sampleRate, 4200, 9800, 160);
    const v15HighPowers = bandPowers(v15High.left, v15High.sampleRate, 4200, 9800, 160);
    const v14HighAir = v14HighPowers.reduce((sum, value) => sum + value, 0);
    const v15HighAir = v15HighPowers.reduce((sum, value) => sum + value, 0);
    const v14Body = bandPower(v14High.left, v14High.sampleRate, 60, 1200, 40);
    const v15Body = bandPower(v15High.left, v15High.sampleRate, 60, 1200, 40);

    expect(rms(v15High.left)).toBeGreaterThan(0.006);
    expect(v15HighAir).toBeLessThan(v14HighAir * 0.66);
    expect(v15HighAir / Math.max(1e-9, v15Body)).toBeLessThan(v14HighAir / Math.max(1e-9, v14Body) * 0.58);
    expect(meanAbsDelta(v15High.left)).toBeLessThan(meanAbsDelta(v14High.left) * 0.94);
  });

  it("models v12 turbo as broadband compressor flow plus restrained blade tone", () => {
    const { left, sampleRate } = generateEnginePcm(
      {
        ...FACTORY_PRESETS["inline-4-turbo"].config,
        soundProfile: "v12",
        seed: 31,
      },
      {
        durationSec: 0.34,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 5200,
        endRpm: 5200,
        throttle: 0.86,
        load: 0.78,
        normalize: false,
      },
    );

    const whooshBand = bandPower(left, sampleRate, 1000, 3000, 80);
    const bladeAndHissBand = bandPower(left, sampleRate, 3600, 9000, 120);
    const turboBands = bandPowers(left, sampleRate, 1500, 9000, 120);

    expect(rms(left)).toBeGreaterThan(0.006);
    expect(whooshBand).toBeGreaterThan(bladeAndHissBand * 0.18);
    expect(tonalDominance(turboBands)).toBeLessThan(0.45);
  });

  it("makes v12 superchargers audible while keeping roots, twin-screw, and centrifugal distinct", () => {
    const base = {
      ...FACTORY_PRESETS["supercharged-v8"].config,
      soundProfile: "v12" as const,
      seed: 41,
      forcedInduction: {
        ...FACTORY_PRESETS["supercharged-v8"].config.forcedInduction,
        whineIntensity: 0.9,
      },
    };
    const render = (config: typeof base) => generateEnginePcm(config, {
      durationSec: 0.30,
      sampleRate: 22050,
      profile: "steady",
      startRpm: 4800,
      endRpm: 4800,
      throttle: 0.76,
      load: 0.72,
      normalize: false,
    }).left;
    const meanAbsDifference = (a: Float32Array, b: Float32Array) => {
      let total = 0;
      for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
      return total / Math.max(1, a.length);
    };

    const naturallyAspirated = render({
      ...base,
      forcedInduction: { ...base.forcedInduction, type: "na" as const },
    });
    const roots = render({ ...base, forcedInduction: { ...base.forcedInduction, type: "supercharged" as const, superchargerType: "roots" as const } });
    const twinScrew = render({ ...base, forcedInduction: { ...base.forcedInduction, type: "supercharged" as const, superchargerType: "twin-screw" as const } });
    const centrifugal = render({ ...base, forcedInduction: { ...base.forcedInduction, type: "supercharged" as const, superchargerType: "centrifugal" as const } });

    const sampleRate = 22050;
    const naBand = bandPower(naturallyAspirated, sampleRate, 1200, 7600, 120);
    expect(bandPower(roots, sampleRate, 1200, 7600, 120)).toBeGreaterThan(naBand * 1.08);
    expect(bandPower(twinScrew, sampleRate, 1200, 7600, 120)).toBeGreaterThan(naBand * 1.10);
    expect(meanAbsDifference(roots, twinScrew)).toBeGreaterThan(0.00065);
    expect(meanAbsDifference(roots, centrifugal)).toBeGreaterThan(0.00065);
  });

  it("varies supercharger character by roots, twin-screw, and centrifugal type", () => {
    function renderSupercharger(superchargerType: "roots" | "twin-screw" | "centrifugal") {
      return generateEnginePcm(
        {
          ...FACTORY_PRESETS["supercharged-v8"].config,
          soundProfile: "clean",
          forcedInduction: {
            ...FACTORY_PRESETS["supercharged-v8"].config.forcedInduction,
            superchargerType,
          },
        },
        {
          durationSec: 0.22,
          sampleRate: 22050,
          profile: "steady",
          startRpm: 3600,
          endRpm: 3600,
          throttle: 0.65,
          load: 0.7,
          normalize: false,
        },
      ).left;
    }

    function meanAbsDifference(a: Float32Array, b: Float32Array) {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
      return sum / a.length;
    }

    const roots = renderSupercharger("roots");
    const twinScrew = renderSupercharger("twin-screw");
    const centrifugal = renderSupercharger("centrifugal");

    expect(meanAbsDifference(roots, twinScrew)).toBeGreaterThan(0.0005);
    expect(meanAbsDifference(roots, centrifugal)).toBeGreaterThan(0.0005);
  });

  it("brings v16 turbo spool in earlier with broadband compressor motion instead of a pure frequency rise", () => {
    const turboConfig = {
      ...FACTORY_PRESETS["inline-4-turbo"].config,
      soundProfile: "v16" as const,
      seed: 61,
    };
    const naConfig = {
      ...turboConfig,
      forcedInduction: { type: "na" as const },
    };
    const render = (config: typeof turboConfig | typeof naConfig, rpm: number) => generateEnginePcm(config, {
      durationSec: 0.42,
      sampleRate: 22050,
      profile: "steady",
      startRpm: rpm,
      endRpm: rpm,
      throttle: 0.72,
      load: 0.66,
      normalize: false,
    }).left;
    const difference = (a: Float32Array, b: Float32Array) => {
      const output = new Float32Array(Math.min(a.length, b.length));
      for (let i = 0; i < output.length; i++) output[i] = a[i] - b[i];
      return output;
    };

    const earlyTurbo = render(turboConfig, 2600);
    const earlyNa = render(naConfig, 2600);
    const earlyAccessory = difference(earlyTurbo, earlyNa);
    const highTurbo = render(turboConfig, 5200);
    const highBands = bandPowers(highTurbo, 22050, 1200, 9000, 140);

    expect(rms(earlyAccessory)).toBeGreaterThan(rms(earlyNa) * 0.10);
    expect(bandPower(earlyAccessory, 22050, 1100, 6200, 100)).toBeGreaterThan(bandPower(earlyNa, 22050, 1100, 6200, 100) * 0.18);
    expect(bandPower(highTurbo, 22050, 850, 3000, 80)).toBeGreaterThan(bandPower(highTurbo, 22050, 4200, 9000, 120) * 0.16);
    expect(tonalDominance(highBands)).toBeLessThan(0.38);
  });

  it("makes v16 roots supercharger whine aggressive and Hellcat-like without muting engine body", () => {
    const base = {
      ...FACTORY_PRESETS["supercharged-v8"].config,
      soundProfile: "v16" as const,
      seed: 71,
      forcedInduction: {
        ...FACTORY_PRESETS["supercharged-v8"].config.forcedInduction,
        superchargerType: "roots" as const,
        whineIntensity: 0.95,
      },
    };
    const na = { ...base, forcedInduction: { type: "na" as const } };
    const render = (config: typeof base | typeof na, rpm: number) => generateEnginePcm(config, {
      durationSec: 0.34,
      sampleRate: 22050,
      profile: "steady",
      startRpm: rpm,
      endRpm: rpm,
      throttle: 0.54,
      load: 0.58,
      normalize: false,
    }).left;

    const rootsLow = render(base, 2400);
    const rootsHigh = render(base, 4800);
    const naHigh = render(na, 4800);

    expect(bandPower(rootsLow, 22050, 1100, 5200, 100)).toBeGreaterThan(bandPower(render(na, 2400), 22050, 1100, 5200, 100) * 1.12);
    expect(bandPower(rootsHigh, 22050, 1500, 7600, 120)).toBeGreaterThan(bandPower(naHigh, 22050, 1500, 7600, 120) * 1.28);
    expect(bandPower(rootsHigh, 22050, 55, 900, 35)).toBeGreaterThan(bandPower(naHigh, 22050, 55, 900, 35) * 0.82);
    expect(peak(rootsHigh)).toBeLessThanOrEqual(1);
  });

  it("renders idle, sweep, and acceleration differently by engine family", () => {
    function renderFamilyEnergy(presetKey: string, profile: "steady" | "sweep" | "acceleration") {
      const config = FACTORY_PRESETS[presetKey].config;
      const { left, right } = generateEnginePcm(config, {
        durationSec: 0.18,
        sampleRate: 22050,
        profile,
        startRpm: profile === "steady" ? 900 : 900,
        endRpm: profile === "steady" ? 900 : config.quick.redline,
        throttle: profile === "steady" ? 0.08 : 0.75,
        load: profile === "steady" ? 0.2 : 0.65,
        normalize: false,
      });
      let energy = 0;
      for (let i = 0; i < left.length; i++) energy += left[i] * left[i] + right[i] * right[i];
      return energy / left.length;
    }

    for (const profile of ["steady", "sweep", "acceleration"] as const) {
      const v8 = renderFamilyEnergy("v8-crossplane", profile);
      const inline4Turbo = renderFamilyEnergy("inline-4-turbo", profile);
      expect(Math.abs(v8 - inline4Turbo)).toBeGreaterThan(0.0001);
    }
  });

  it("keeps current high-cylinder live loudness from falling away", () => {
    function renderAudibleRms(cylinderCount: number) {
      const config = {
        ...DEFAULT_ENGINE_CONFIG,
        soundProfile: "v16" as const,
        quick: {
          ...DEFAULT_ENGINE_CONFIG.quick,
          cylinderCount,
          displacement: 5.6,
          crankshaft: cylinderCount === 8 ? "cross-plane" as const : "even-fire" as const,
          redline: 7600,
        },
        forcedInduction: { type: "na" as const },
      };
      const { left } = generateEnginePcm(config, {
        durationSec: 0.30,
        sampleRate: 22050,
        profile: "steady",
        startRpm: 3600,
        endRpm: 3600,
        throttle: 0.58,
        load: 0.62,
        normalize: false,
      });
      return rms(left) * resolveLiveOutputGain(config);
    }

    const cylinders8 = renderAudibleRms(8);
    const cylinders10 = renderAudibleRms(10);
    const cylinders12 = renderAudibleRms(12);

    expect(cylinders10).toBeGreaterThan(cylinders8 * 0.82);
    expect(cylinders12).toBeGreaterThan(cylinders8 * 0.82);
    expect(cylinders12).toBeGreaterThan(0.0075);
  });

  it("keeps v11 dense V12 stereo from becoming a left-right metronome", () => {
    const config = {
      ...FACTORY_PRESETS["v12"].config,
      soundProfile: "v11" as const,
      seed: 42,
      quick: {
        ...FACTORY_PRESETS["v12"].config.quick,
        redline: 9200,
      },
    };
    const { left, right } = generateEnginePcm(config, {
      durationSec: 0.36,
      sampleRate: 22050,
      profile: "steady",
      startRpm: 8600,
      endRpm: 8600,
      throttle: 0.82,
      load: 0.72,
      normalize: false,
    });

    let midSquares = 0;
    let sideSquares = 0;
    for (let i = Math.floor(left.length * 0.25); i < left.length; i++) {
      const mid = (left[i] + right[i]) * 0.5;
      const side = (left[i] - right[i]) * 0.5;
      midSquares += mid * mid;
      sideSquares += side * side;
    }

    const sideMidRatio = Math.sqrt(sideSquares / Math.max(1e-9, midSquares));
    expect(rms(left)).toBeGreaterThan(0.006);
    expect(sideMidRatio).toBeLessThan(0.32);
  });

  it("makes displacement, exhaust, intake, and stroke controls measurably affect sound", () => {
    const base = {
      ...FACTORY_PRESETS["v8-crossplane"].config,
      soundProfile: "v10" as const,
      seed: 77,
    };
    const render = (config: typeof base) => generateEnginePcm(config, {
      durationSec: 0.24,
      sampleRate: 22050,
      profile: "steady",
      startRpm: 3200,
      endRpm: 3200,
      throttle: 0.72,
      load: 0.70,
      normalize: false,
    }).left;
    const meanAbsDifference = (a: Float32Array, b: Float32Array) => {
      let total = 0;
      for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
      return total / Math.max(1, a.length);
    };

    const smallDisplacement = render({ ...base, quick: { ...base.quick, displacement: 3.0 } });
    const largeDisplacement = render({ ...base, quick: { ...base.quick, displacement: 6.4 } });
    expect(bandPower(largeDisplacement, 22050, 45, 180, 5)).toBeGreaterThan(bandPower(smallDisplacement, 22050, 45, 180, 5) * 1.08);

    const stock = render({ ...base, quick: { ...base.quick, exhaustCharacter: "stock" } });
    const straightPipe = render({ ...base, quick: { ...base.quick, exhaustCharacter: "straight-pipe" } });
    expect(bandPower(straightPipe, 22050, 1500, 5200, 80)).toBeGreaterThan(bandPower(stock, 22050, 1500, 5200, 80) * 1.12);

    const airbox = render({ ...base, advanced: { ...base.advanced, intakeType: "airbox" } });
    const velocityStacks = render({ ...base, advanced: { ...base.advanced, intakeType: "velocity-stacks" } });
    const airboxAnalysis = buildEngineSoundAnalysis({ ...base, advanced: { ...base.advanced, intakeType: "airbox" } });
    const velocityStacksAnalysis = buildEngineSoundAnalysis({ ...base, advanced: { ...base.advanced, intakeType: "velocity-stacks" } });
    expect(velocityStacksAnalysis.intakeGain).toBeGreaterThan(airboxAnalysis.intakeGain * 2);
    expect(velocityStacksAnalysis.acousticProfile.geometry.intakeRunnerLengthCm).toBeLessThan(airboxAnalysis.acousticProfile.geometry.intakeRunnerLengthCm);
    expect(meanAbsDifference(velocityStacks, airbox)).toBeGreaterThan(0.00045);

    const shortStrokeProfile = buildEngineAcousticProfile({ ...base, advanced: { ...base.advanced, bore: 102, stroke: 62 } }, 3200);
    const longStrokeProfile = buildEngineAcousticProfile({ ...base, advanced: { ...base.advanced, bore: 82, stroke: 110 } }, 3200);
    const shortBlock = shortStrokeProfile.resonanceModes.find((mode) => mode.name === "block-body")!;
    const longBlock = longStrokeProfile.resonanceModes.find((mode) => mode.name === "block-body")!;
    expect(longStrokeProfile.bassShelf).toBeGreaterThan(shortStrokeProfile.bassShelf);
    expect(longBlock.frequencyHz).toBeLessThan(shortBlock.frequencyHz);
  });
});
