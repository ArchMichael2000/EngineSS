import type { EngineConfiguration, EngineLayout, CrankshaftType } from "./engineTypes";
import {
  DEFAULT_SOUND_TUNING_WEIGHTS,
  getDefaultFiringOrder,
  isAirwashControlSoundProfile,
  isBaselineSoundProfile,
  isClaritySoundProfile,
  isAccessoryQualitySoundProfile,
  isCleanHandoffSoundProfile,
  isCylinderBalanceSoundProfile,
  isStaticCleanSoundProfile,
  isStereoStabilitySoundProfile,
  normalizeSoundProfile,
} from "./engineTypes";
import type { SoundProfile } from "./engineTypes";
import type { SoundTuningWeights } from "./engineTypes";

export interface FiringEventProfile {
  cylinder: number;
  sequenceIndex: number;
  angleDeg: number;
  intervalDeg: number;
  bankIndex: number;
  pan: number;
  pipeDelaySec: number;
  amplitude: number;
  toneOffset: number;
  resonanceSkew: number;
  bodyBias: number;
  throatBias: number;
  blowdownBias: number;
}

export interface EngineOrderSpectrum {
  cycleOrder: number;
  engineOrder: number;
  frequencyHz: number;
  wholeEngineGain: number;
  bankGains: number[];
  bankDifference: number;
  phaseRad: number;
}

export interface ResonanceMode {
  name: "exhaust-quarter" | "primary-pipe" | "block-body" | "intake-runner";
  frequencyHz: number;
  gain: number;
  decaySec: number;
  q: number;
}

export interface AcousticGeometry {
  primaryTubeLengthCm: number;
  exhaustLengthCm: number;
  mufflerVolumeL: number;
  intakeRunnerLengthCm: number;
}

export interface EngineFamilySoundPreset {
  id: string;
  lowOrderGain: number;
  bodyResonanceGain: number;
  bassShelf: number;
  pulseDensitySmoothing: number;
  spectralTilt: number;
  highOrderGain: number;
  perceivedPitchBias: number;
  geometry: AcousticGeometry;
}

export interface EngineAcousticProfile {
  cycleHz: number;
  firingEventHz: number;
  perceivedPitchIndex: number;
  lowOrderEnergy: number;
  bankRoughness: number;
  pulseDensitySmoothing: number;
  bassShelf: number;
  spectralTilt: number;
  bodyResonanceGain: number;
  orderSpectrum: EngineOrderSpectrum[];
  resonanceModes: ResonanceMode[];
  familyPreset: EngineFamilySoundPreset;
  geometry: AcousticGeometry;
}

export interface EngineSoundAnalysis {
  cylinderCount: number;
  cycleDegrees: 720;
  bankCount: number;
  firingOrder: number[];
  intervalsDeg: number[];
  events: FiringEventProfile[];
  perCylinderDisplacement: number;
  exhaustBrightness: number;
  exhaustGain: number;
  intakeGain: number;
  idleInstability: number;
  acousticProfile: EngineAcousticProfile;
}

export interface EngineRenderOptions {
  durationSec: number;
  sampleRate?: number;
  normalize?: boolean;
  startRpm?: number;
  endRpm?: number;
  load?: number;
  throttle?: number;
  profile?: "sweep" | "steady" | "acceleration";
}

interface Pulse {
  ageSec: number;
  amp: number;
  pan: number;
  decaySec: number;
  subHz: number;
  subGain: number;
  bodyHz: number;
  bodyGain: number;
  growlHz: number;
  pipeHz: number;
  pipeGain: number;
  presenceHz: number;
  presenceGain: number;
  scatterHzA: number;
  scatterHzB: number;
  scatterPhaseA: number;
  scatterPhaseB: number;
  airBurstGain: number;
  pressureSkew: number;
  previousPressure: number;
  pipeChirp: number;
  throatGain: number;
  throatNoise: number;
  throatNoiseLow: number;
  blowdownGain: number;
  blowdownPhase: number;
  radiationGain: number;
  radiationPhase: number;
  radiationNoise: number;
  radiationNoiseLow: number;
  reflectionDelayA: number;
  reflectionDelayB: number;
  reflectionGain: number;
  airNoise: number;
  airNoiseLow: number;
  crackle: number;
  toneOffset: number;
}

interface SynthesisState {
  analysis: EngineSoundAnalysis;
  sampleRate: number;
  crankAngleDeg: number;
  nextFireAbsDeg: number;
  eventIndex: number;
  pulses: Pulse[];
  seed: number;
  rumblePhase: number;
  intakePhase: number;
  intakeResonancePhase: number;
  boostPhase: number;
  mechPhase: number;
  exhaustNoise: number;
  intakeNoise: number;
  intakeNoiseLow: number;
  turboSpool: number;
  turboWhooshFast: number;
  turboWhooshSlow: number;
  turboBladePhase: number;
  turboFlutterPhase: number;
  superchargerLobePhase: number;
  superchargerGearPhase: number;
  superchargerNoise: number;
  mechanicalNoise: number;
  mechanicalNoiseLow: number;
  mechanicalTickEnvelope: number;
  combustionEnvelope: number;
  combustionEdgeEnvelope: number;
  previousLeftInput: number;
  previousRightInput: number;
  previousLeftOutput: number;
  previousRightOutput: number;
  tuning: SoundTuningWeights;
}

const TWO_PI = Math.PI * 2;
const SPEED_OF_SOUND_MPS = 343;
const MAX_CYCLE_ORDER = 32;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function shapeClarityOutput(input: number): number {
  const sign = input < 0 ? -1 : 1;
  const magnitude = Math.abs(input);
  const knee = 0.74;
  if (magnitude <= knee) return input;

  const headroom = 1 - knee;
  const shaped = knee + headroom * (1 - Math.exp(-(magnitude - knee) / headroom));
  return sign * clamp(shaped, 0, 1);
}

export function dcBlockCoefficientForSoundProfile(soundProfile: SoundProfile | undefined): number {
  return isClaritySoundProfile(soundProfile) ? 0.9992 : 0.995;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function resolveSoundTuningWeights(config: EngineConfiguration): SoundTuningWeights {
  const weights = config.soundTuning?.weights;
  return {
    combustionEdge: clamp(weights?.combustionEdge ?? DEFAULT_SOUND_TUNING_WEIGHTS.combustionEdge, 0.35, 1.85),
    exhaustFormantShift: clamp(weights?.exhaustFormantShift ?? DEFAULT_SOUND_TUNING_WEIGHTS.exhaustFormantShift, 0.35, 1.85),
    exhaustBrightness: clamp(weights?.exhaustBrightness ?? DEFAULT_SOUND_TUNING_WEIGHTS.exhaustBrightness, 0.35, 1.85),
    orderHarmonicGain: clamp(weights?.orderHarmonicGain ?? DEFAULT_SOUND_TUNING_WEIGHTS.orderHarmonicGain, 0.35, 1.85),
    intakeTexture: clamp(weights?.intakeTexture ?? DEFAULT_SOUND_TUNING_WEIGHTS.intakeTexture, 0.35, 1.85),
    turboWhoosh: clamp(weights?.turboWhoosh ?? DEFAULT_SOUND_TUNING_WEIGHTS.turboWhoosh, 0.35, 1.85),
    turboTone: clamp(weights?.turboTone ?? DEFAULT_SOUND_TUNING_WEIGHTS.turboTone, 0.35, 1.85),
    superchargerWhine: clamp(weights?.superchargerWhine ?? DEFAULT_SOUND_TUNING_WEIGHTS.superchargerWhine, 0.35, 1.85),
    muffling: clamp(weights?.muffling ?? DEFAULT_SOUND_TUNING_WEIGHTS.muffling, 0.35, 1.85),
    clarity: clamp(weights?.clarity ?? DEFAULT_SOUND_TUNING_WEIGHTS.clarity, 0.35, 1.85),
    lowOrderGain: clamp(weights?.lowOrderGain ?? DEFAULT_SOUND_TUNING_WEIGHTS.lowOrderGain, 0.35, 1.85),
    bodyResonanceGain: clamp(weights?.bodyResonanceGain ?? DEFAULT_SOUND_TUNING_WEIGHTS.bodyResonanceGain, 0.35, 1.85),
    bassShelf: clamp(weights?.bassShelf ?? DEFAULT_SOUND_TUNING_WEIGHTS.bassShelf, 0.35, 1.85),
    pulseDensitySmoothing: clamp(weights?.pulseDensitySmoothing ?? DEFAULT_SOUND_TUNING_WEIGHTS.pulseDensitySmoothing, 0.35, 1.85),
    spectralTilt: clamp(weights?.spectralTilt ?? DEFAULT_SOUND_TUNING_WEIGHTS.spectralTilt, 0.35, 1.85),
  };
}

function normalizeIntervals(intervals: number[]) {
  const total = intervals.reduce((sum, value) => sum + value, 0) || 720;
  const scale = 720 / total;
  return intervals.map((value) => value * scale);
}

function nextRandom(state: SynthesisState) {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

function hashNoise(seed: number) {
  let x = seed >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) / 4294967296) * 2 - 1;
}

function bankCountForLayout(layout: EngineLayout, cylinderCount: number) {
  if (layout === "v" || layout === "flat") return cylinderCount > 1 ? 2 : 1;
  if (layout === "w") return Math.min(4, Math.max(1, Math.ceil(cylinderCount / 4)));
  return 1;
}

function bankIndexForCylinder(layout: EngineLayout, cylinder: number, bankCount: number) {
  if (bankCount <= 1) return 0;
  if (layout === "w") return (cylinder - 1) % bankCount;
  return cylinder % 2 === 1 ? 0 : 1;
}

function panForBank(bankIndex: number, bankCount: number, routing: string | undefined) {
  if (routing === "single" || bankCount <= 1) return 0;
  if (bankCount === 2) return bankIndex === 0 ? -0.42 : 0.42;
  return -0.6 + (1.2 * bankIndex) / Math.max(1, bankCount - 1);
}

function quarterWaveHz(lengthCm: number) {
  return SPEED_OF_SOUND_MPS / (4 * Math.max(0.22, lengthCm / 100));
}

function resolveAcousticGeometry(config: EngineConfiguration, base: AcousticGeometry): AcousticGeometry {
  const exhaustCharacter = config.quick.exhaustCharacter;
  const routing = config.advanced?.exhaustRouting ?? (config.quick.layout === "v" || config.quick.layout === "flat" ? "dual" : "single");
  const characterLengthShift = exhaustCharacter === "stock" ? 26 : exhaustCharacter === "sport" ? 6 : exhaustCharacter === "race" ? -18 : -52;
  const routingLengthShift = routing === "open-headers" ? -112 : routing === "dual" ? -18 : 0;
  const intakeType = config.advanced?.intakeType ?? "single-throttle-body";
  const intakeLengthShift = intakeType === "velocity-stacks" ? -13 : intakeType === "itbs" ? -8 : intakeType === "carb" ? 3 : intakeType === "airbox" ? 10 : 0;
  const mufflerMap = {
    stock: 34,
    sport: 22,
    race: 12,
    "straight-pipe": 3,
  } as const;

  return {
    primaryTubeLengthCm: clamp(config.advanced?.primaryTubeLengthCm ?? base.primaryTubeLengthCm, 34, 120),
    exhaustLengthCm: clamp(config.advanced?.exhaustLengthCm ?? (base.exhaustLengthCm + characterLengthShift + routingLengthShift), 85, 430),
    mufflerVolumeL: clamp(config.advanced?.mufflerVolumeL ?? Math.max(base.mufflerVolumeL, mufflerMap[exhaustCharacter]), 0.5, 60),
    intakeRunnerLengthCm: clamp(config.advanced?.intakeRunnerLengthCm ?? (base.intakeRunnerLengthCm + intakeLengthShift), 10, 75),
  };
}

export function getEngineFamilySoundPreset(config: EngineConfiguration): EngineFamilySoundPreset {
  const { quick } = config;
  const cylinderCount = Math.max(1, Math.floor(quick.cylinderCount));
  const perCylinder = quick.displacement / cylinderCount;
  const bore = config.advanced?.bore ?? 90;
  const stroke = config.advanced?.stroke ?? 86;
  const boreBias = clamp((bore - 90) / 44, -0.8, 0.9);
  const strokeBias = clamp((stroke - 86) / 42, -0.8, 0.9);
  const base: EngineFamilySoundPreset = {
    id: "generic",
    lowOrderGain: 0.98,
    bodyResonanceGain: 1.0,
    bassShelf: 1.0,
    pulseDensitySmoothing: 1.0,
    spectralTilt: 1.0,
    highOrderGain: 1.0,
    perceivedPitchBias: 0,
    geometry: {
      primaryTubeLengthCm: 68,
      exhaustLengthCm: 292,
      mufflerVolumeL: 20,
      intakeRunnerLengthCm: 34,
    },
  };

  let preset: EngineFamilySoundPreset = base;

  if (quick.layout === "inline" && cylinderCount === 4) {
    preset = {
      ...base,
      id: "inline-4",
      lowOrderGain: 1.10,
      bodyResonanceGain: 1.04,
      bassShelf: 0.98,
      pulseDensitySmoothing: 0.86,
      spectralTilt: 0.96,
      highOrderGain: 1.06,
      perceivedPitchBias: 0.04,
      geometry: { primaryTubeLengthCm: 72, exhaustLengthCm: 300, mufflerVolumeL: 22, intakeRunnerLengthCm: 38 },
    };
  } else if (quick.layout === "inline" && cylinderCount === 6) {
    preset = {
      ...base,
      id: "inline-6",
      lowOrderGain: 0.82,
      bodyResonanceGain: 0.96,
      bassShelf: 0.96,
      pulseDensitySmoothing: 1.16,
      spectralTilt: 0.94,
      highOrderGain: 0.98,
      perceivedPitchBias: -0.03,
      geometry: { primaryTubeLengthCm: 70, exhaustLengthCm: 310, mufflerVolumeL: 24, intakeRunnerLengthCm: 40 },
    };
  } else if (quick.layout === "v" && cylinderCount === 8 && quick.crankshaft === "cross-plane") {
    preset = {
      ...base,
      id: "cross-plane-v8",
      lowOrderGain: 1.38,
      bodyResonanceGain: 1.32,
      bassShelf: 1.26,
      pulseDensitySmoothing: 0.92,
      spectralTilt: 1.14,
      highOrderGain: 0.90,
      perceivedPitchBias: -0.13,
      geometry: { primaryTubeLengthCm: 80, exhaustLengthCm: 326, mufflerVolumeL: 25, intakeRunnerLengthCm: 32 },
    };
  } else if (quick.layout === "v" && cylinderCount === 8 && quick.crankshaft === "flat-plane") {
    preset = {
      ...base,
      id: "flat-plane-v8",
      lowOrderGain: 0.90,
      bodyResonanceGain: 1.12,
      bassShelf: 1.05,
      pulseDensitySmoothing: 1.04,
      spectralTilt: 0.92,
      highOrderGain: 1.24,
      perceivedPitchBias: 0.15,
      geometry: { primaryTubeLengthCm: 62, exhaustLengthCm: 262, mufflerVolumeL: 13, intakeRunnerLengthCm: 28 },
    };
  } else if (quick.layout === "flat" && cylinderCount === 6) {
    preset = {
      ...base,
      id: "flat-6",
      lowOrderGain: 1.12,
      bodyResonanceGain: 1.18,
      bassShelf: 1.12,
      pulseDensitySmoothing: 1.00,
      spectralTilt: 1.06,
      highOrderGain: 1.02,
      perceivedPitchBias: -0.02,
      geometry: { primaryTubeLengthCm: 72, exhaustLengthCm: 286, mufflerVolumeL: 18, intakeRunnerLengthCm: 31 },
    };
  } else if (quick.layout === "v" && cylinderCount === 10) {
    preset = {
      ...base,
      id: "v10",
      lowOrderGain: 0.92,
      bodyResonanceGain: 1.06,
      bassShelf: 1.02,
      pulseDensitySmoothing: 1.22,
      spectralTilt: 0.90,
      highOrderGain: 1.18,
      perceivedPitchBias: 0.10,
      geometry: { primaryTubeLengthCm: 58, exhaustLengthCm: 254, mufflerVolumeL: 12, intakeRunnerLengthCm: 27 },
    };
  } else if (quick.layout === "v" && cylinderCount === 12) {
    preset = {
      ...base,
      id: "v12",
      lowOrderGain: 0.86,
      bodyResonanceGain: 1.12,
      bassShelf: 1.08,
      pulseDensitySmoothing: 1.34,
      spectralTilt: 0.96,
      highOrderGain: 1.08,
      perceivedPitchBias: 0.02,
      geometry: { primaryTubeLengthCm: 60, exhaustLengthCm: 282, mufflerVolumeL: 18, intakeRunnerLengthCm: 30 },
    };
  }

  const displacementBias = clamp((perCylinder - 0.55) * 0.18, -0.08, 0.14);
  const geometryBias: AcousticGeometry = {
    primaryTubeLengthCm: clamp(preset.geometry.primaryTubeLengthCm + strokeBias * 7 - boreBias * 3, 34, 120),
    exhaustLengthCm: clamp(preset.geometry.exhaustLengthCm + strokeBias * 18 - boreBias * 8, 85, 430),
    mufflerVolumeL: preset.geometry.mufflerVolumeL,
    intakeRunnerLengthCm: clamp(preset.geometry.intakeRunnerLengthCm + strokeBias * 5 - boreBias * 6, 10, 75),
  };
  return {
    ...preset,
    bodyResonanceGain: clamp(preset.bodyResonanceGain + displacementBias + strokeBias * 0.045, 0.65, 1.55),
    bassShelf: clamp(preset.bassShelf + displacementBias * 0.75 + strokeBias * 0.055, 0.65, 1.55),
    spectralTilt: clamp(preset.spectralTilt + strokeBias * 0.035 - boreBias * 0.030, 0.72, 1.32),
    highOrderGain: clamp(preset.highOrderGain + boreBias * 0.070 - strokeBias * 0.030, 0.72, 1.45),
    geometry: resolveAcousticGeometry(config, geometryBias),
  };
}

function calculateOrderSpectrum(events: FiringEventProfile[], bankCount: number, rpm: number): EngineOrderSpectrum[] {
  const safeEvents = events.length ? events : [{ angleDeg: 0, amplitude: 1, bankIndex: 0 } as FiringEventProfile];
  const totalAmplitude = safeEvents.reduce((sum, event) => sum + Math.max(0.001, event.amplitude), 0);
  const bankTotals = Array.from({ length: Math.max(1, bankCount) }, (_, bank) =>
    safeEvents
      .filter((event) => event.bankIndex === bank)
      .reduce((sum, event) => sum + Math.max(0.001, event.amplitude), 0),
  );
  const cycleHz = calculateFourStrokeCycleRate(rpm);

  return Array.from({ length: MAX_CYCLE_ORDER }, (_, index) => {
    const cycleOrder = index + 1;
    let real = 0;
    let imaginary = 0;
    const bankVectors = bankTotals.map(() => ({ real: 0, imaginary: 0 }));

    for (const event of safeEvents) {
      const amplitude = Math.max(0.001, event.amplitude);
      const theta = TWO_PI * cycleOrder * (event.angleDeg / 720);
      const c = Math.cos(theta);
      const s = -Math.sin(theta);
      real += amplitude * c;
      imaginary += amplitude * s;
      const bankVector = bankVectors[event.bankIndex] ?? bankVectors[0];
      bankVector.real += amplitude * c;
      bankVector.imaginary += amplitude * s;
    }

    const bankGains = bankVectors.map((vector, bank) => {
      const total = Math.max(0.001, bankTotals[bank] ?? totalAmplitude);
      return clamp(Math.sqrt(vector.real * vector.real + vector.imaginary * vector.imaginary) / total, 0, 1);
    });
    const wholeEngineGain = clamp(Math.sqrt(real * real + imaginary * imaginary) / totalAmplitude, 0, 1);
    const meanBankGain = mean(bankGains);

    return {
      cycleOrder,
      engineOrder: cycleOrder / 2,
      frequencyHz: cycleHz * cycleOrder,
      wholeEngineGain,
      bankGains,
      bankDifference: clamp(meanBankGain - wholeEngineGain * 0.38, 0, 1),
      phaseRad: Math.atan2(imaginary, real),
    };
  });
}

function resonanceMode(
  name: ResonanceMode["name"],
  frequencyHz: number,
  gain: number,
  decaySec: number,
  q: number,
): ResonanceMode {
  return {
    name,
    frequencyHz: clamp(frequencyHz, 24, 1800),
    gain: clamp(gain, 0.05, 2.2),
    decaySec: clamp(decaySec, 0.008, 0.22),
    q: clamp(q, 0.25, 6),
  };
}

function createEngineAcousticProfile(
  config: EngineConfiguration,
  events: FiringEventProfile[],
  bankCount: number,
  perCylinderDisplacement: number,
  rpm = 1000,
): EngineAcousticProfile {
  const preset = getEngineFamilySoundPreset(config);
  const cycleHz = calculateFourStrokeCycleRate(rpm);
  const orderSpectrum = calculateOrderSpectrum(events, bankCount, rpm);
  const lowOrderBins = orderSpectrum.filter((bin) => bin.cycleOrder <= 6);
  const highOrderBins = orderSpectrum.filter((bin) => bin.cycleOrder >= Math.max(7, Math.floor(config.quick.cylinderCount * 0.8)));
  const lowOrderEnergy = clamp(
    mean(lowOrderBins.map((bin) => bin.bankDifference * 0.72 + bin.wholeEngineGain * 0.28)) * preset.lowOrderGain,
    0,
    1.65,
  );
  const bankRoughness = clamp(mean(lowOrderBins.map((bin) => bin.bankDifference)) * (bankCount > 1 ? 1.35 : 0.82), 0, 1.65);
  const highOrderEnergy = mean(highOrderBins.map((bin) => bin.wholeEngineGain + bin.bankDifference * 0.35));
  const displacementScale = clamp(config.quick.displacement / 5, 0.45, 1.9);
  const bodyBaseHz = clamp(
    42 + displacementScale * 14 + perCylinderDisplacement * 18 - (preset.bassShelf - 1) * 9,
    38,
    92,
  );
  const exhaustQuarter = quarterWaveHz(preset.geometry.exhaustLengthCm);
  const primaryQuarter = quarterWaveHz(preset.geometry.primaryTubeLengthCm);
  const intakeQuarter = quarterWaveHz(preset.geometry.intakeRunnerLengthCm);
  const mufflerDamping = clamp(preset.geometry.mufflerVolumeL / 30, 0.08, 1.8);
  const perceivedPitchIndex = clamp(
    0.94 +
      preset.perceivedPitchBias +
      (highOrderEnergy - lowOrderEnergy) * 0.10 +
      (0.58 - perCylinderDisplacement) * 0.11 -
      (preset.bassShelf - 1) * 0.08,
    0.58,
    1.42,
  );

  return {
    cycleHz,
    firingEventHz: cycleHz * Math.max(1, Math.floor(config.quick.cylinderCount)),
    perceivedPitchIndex,
    lowOrderEnergy,
    bankRoughness,
    pulseDensitySmoothing: preset.pulseDensitySmoothing,
    bassShelf: preset.bassShelf,
    spectralTilt: preset.spectralTilt,
    bodyResonanceGain: preset.bodyResonanceGain,
    orderSpectrum,
    resonanceModes: [
      resonanceMode("exhaust-quarter", exhaustQuarter, 0.62 * preset.bassShelf, 0.095 + mufflerDamping * 0.035, 0.72),
      resonanceMode("block-body", bodyBaseHz, 0.72 * preset.bodyResonanceGain, 0.070 + displacementScale * 0.020, 0.92),
      resonanceMode("primary-pipe", primaryQuarter, 0.54 + preset.highOrderGain * 0.16, 0.034 + (1 - mufflerDamping * 0.25) * 0.014, 1.34),
      resonanceMode("intake-runner", intakeQuarter, 0.30, 0.026, 1.25),
    ],
    familyPreset: preset,
    geometry: preset.geometry,
  };
}

export function calculateFiringIntervals(cylinderCount: number, crankshaft: CrankshaftType, layout: EngineLayout): number[] {
  const count = Math.max(1, Math.floor(cylinderCount));
  const even = 720 / count;

  if (crankshaft === "odd-fire") {
    const stagger = clamp(even * 0.22, 8, 34);
    return normalizeIntervals(Array.from({ length: count }, (_, i) => even + (i % 2 === 0 ? stagger : -stagger)));
  }

  if (layout === "radial" && count % 2 === 0) {
    const stagger = clamp(even * 0.14, 6, 20);
    return normalizeIntervals(Array.from({ length: count }, (_, i) => even + (i % 2 === 0 ? stagger : -stagger)));
  }

  return Array(count).fill(even);
}

export function calculateFourStrokeFiringRate(rpm: number, cylinderCount: number): number {
  return calculateFourStrokeCycleRate(rpm) * Math.max(1, cylinderCount);
}

export function calculateFourStrokeCycleRate(rpm: number): number {
  return rpm / 120;
}

export function calculateEngineOrderFrequency(rpm: number, order: number): number {
  return (rpm / 60) * order;
}

export function buildEngineSoundAnalysis(config: EngineConfiguration): EngineSoundAnalysis {
  const { quick, advanced } = config;
  const cylinderCount = Math.max(1, Math.floor(quick.cylinderCount));
  const bankCount = bankCountForLayout(quick.layout, cylinderCount);
  const firingOrder = (advanced?.firingOrder?.length === cylinderCount
    ? advanced.firingOrder
    : getDefaultFiringOrder(quick.layout, cylinderCount, quick.crankshaft)
  ).slice(0, cylinderCount);
  const intervalsDeg = calculateFiringIntervals(cylinderCount, quick.crankshaft, quick.layout);
  const perCylinderDisplacement = quick.displacement / cylinderCount;
  const bore = advanced?.bore ?? 90;
  const stroke = advanced?.stroke ?? 86;
  const boreBias = clamp((bore - 90) / 44, -0.8, 0.9);
  const strokeBias = clamp((stroke - 86) / 42, -0.8, 0.9);

  const exhaustBrightnessMap = {
    stock: 0.35,
    sport: 0.58,
    race: 0.82,
    "straight-pipe": 1.0,
  } as const;
  const exhaustGainMap = {
    stock: 0.68,
    sport: 0.84,
    race: 1.02,
    "straight-pipe": 1.15,
  } as const;
  const idleInstabilityMap = {
    smooth: 0.006,
    lumpy: 0.025,
    aggressive: 0.045,
    lopey: 0.07,
  } as const;
  const intakeGainMap = {
    "single-throttle-body": 0.22,
    itbs: 0.38,
    carb: 0.30,
    "velocity-stacks": 0.44,
    airbox: 0.18,
  } as const;

  let angle = 0;
  const events = firingOrder.map((cylinder, sequenceIndex) => {
    const rawBankIndex = bankIndexForCylinder(quick.layout, cylinder, bankCount);
    const bankIndex = quick.layout === "v" && bankCount === 2 && quick.crankshaft === "flat-plane"
      ? sequenceIndex % 2
      : rawBankIndex;
    const headerUnequal = advanced?.headerGeometry === "unequal-length";
    const routing = advanced?.exhaustRouting ?? (bankCount > 1 ? "dual" : "single");
    const cylinderNoise = hashNoise((config.seed ?? 42) + cylinder * 97 + sequenceIndex * 13);
    const resonanceNoise = hashNoise((config.seed ?? 42) + cylinder * 151 + sequenceIndex * 31);
    const bodyNoise = hashNoise((config.seed ?? 42) + cylinder * 211 + sequenceIndex * 43);
    const throatNoise = hashNoise((config.seed ?? 42) + cylinder * 263 + sequenceIndex * 59);
    const blowdownNoise = hashNoise((config.seed ?? 42) + cylinder * 307 + sequenceIndex * 71);
    const pipeDelaySec = headerUnequal ? 0.0015 + (cylinderNoise + 1) * 0.0024 : 0.001;
    const bankAngleFactor = quick.layout === "v" ? Math.abs((advanced?.bankAngle ?? 90) - 90) / 90 : 0;
    const chamberBias = boreBias * 0.030 + strokeBias * 0.045;
    const amplitude = clamp(0.82 + perCylinderDisplacement * 0.22 + chamberBias + cylinderNoise * 0.045 + bankAngleFactor * 0.05, 0.72, 1.30);
    const event: FiringEventProfile = {
      cylinder,
      sequenceIndex,
      angleDeg: angle,
      intervalDeg: intervalsDeg[sequenceIndex] ?? 720 / cylinderCount,
      bankIndex,
      pan: panForBank(bankIndex, bankCount, routing),
      pipeDelaySec,
      amplitude,
      toneOffset: cylinderNoise * 0.65,
      resonanceSkew: clamp(1 + resonanceNoise * 0.055, 0.92, 1.08),
      bodyBias: clamp(1 + bodyNoise * 0.075, 0.88, 1.12),
      throatBias: clamp(1 + throatNoise * 0.105, 0.82, 1.18),
      blowdownBias: clamp(1 + blowdownNoise * 0.125, 0.78, 1.22),
    };
    angle += event.intervalDeg;
    return event;
  });
  const acousticProfile = createEngineAcousticProfile(config, events, bankCount, perCylinderDisplacement);

  return {
    cylinderCount,
    cycleDegrees: 720,
    bankCount,
    firingOrder,
    intervalsDeg,
    events,
    perCylinderDisplacement,
    exhaustBrightness: clamp(exhaustBrightnessMap[quick.exhaustCharacter] * (1 + boreBias * 0.10 - strokeBias * 0.055), 0.22, 1.20),
    exhaustGain: clamp(exhaustGainMap[quick.exhaustCharacter] * (1 + strokeBias * 0.045 + boreBias * 0.025), 0.55, 1.28),
    intakeGain: clamp(intakeGainMap[advanced?.intakeType ?? "single-throttle-body"] * (1 + boreBias * 0.12 - strokeBias * 0.035), 0.12, 0.58),
    idleInstability: idleInstabilityMap[quick.idleCharacter],
    acousticProfile,
  };
}

export function buildEngineAcousticProfile(config: EngineConfiguration, rpm = 1000): EngineAcousticProfile {
  const analysis = buildEngineSoundAnalysis(config);
  return createEngineAcousticProfile(config, analysis.events, analysis.bankCount, analysis.perCylinderDisplacement, rpm);
}

function createState(config: EngineConfiguration, sampleRate: number): SynthesisState {
  return {
    analysis: buildEngineSoundAnalysis(config),
    sampleRate,
    crankAngleDeg: 0,
    nextFireAbsDeg: 0,
    eventIndex: 0,
    pulses: [],
    seed: config.seed ?? 42,
    rumblePhase: 0,
    intakePhase: 0,
    intakeResonancePhase: 0,
    boostPhase: 0,
    mechPhase: 0,
    exhaustNoise: 0,
    intakeNoise: 0,
    intakeNoiseLow: 0,
    turboSpool: 0,
    turboWhooshFast: 0,
    turboWhooshSlow: 0,
    turboBladePhase: 0,
    turboFlutterPhase: 0,
    superchargerLobePhase: 0,
    superchargerGearPhase: 0,
    superchargerNoise: 0,
    mechanicalNoise: 0,
    mechanicalNoiseLow: 0,
    mechanicalTickEnvelope: 0,
    combustionEnvelope: 0,
    combustionEdgeEnvelope: 0,
    previousLeftInput: 0,
    previousRightInput: 0,
    previousLeftOutput: 0,
    previousRightOutput: 0,
    tuning: resolveSoundTuningWeights(config),
  };
}

function addPulse(state: SynthesisState, config: EngineConfiguration, event: FiringEventProfile, rpm: number, throttle: number, load: number) {
  event.amplitude = Number.isFinite(event.amplitude) ? event.amplitude : 1;
  event.pan = clamp(Number.isFinite(event.pan) ? event.pan : 0, -0.98, 0.98);
  event.pipeDelaySec = clamp(Number.isFinite(event.pipeDelaySec) ? event.pipeDelaySec : 0.001, 0, 0.030);
  event.toneOffset = Number.isFinite(event.toneOffset) ? event.toneOffset : 0;
  event.resonanceSkew = Number.isFinite(event.resonanceSkew) ? event.resonanceSkew : 1;
  event.bodyBias = Number.isFinite(event.bodyBias) ? event.bodyBias : 1;
  event.throatBias = Number.isFinite(event.throatBias) ? event.throatBias : 1;
  event.blowdownBias = Number.isFinite(event.blowdownBias) ? event.blowdownBias : 1;

  const { quick } = config;
  const soundProfile = normalizeSoundProfile(config.soundProfile);
  const cleanProfile = !isBaselineSoundProfile(soundProfile);
  const clarityProfile = isClaritySoundProfile(soundProfile);
  const cylinderBalanceProfile = isCylinderBalanceSoundProfile(soundProfile);
  const stereoStabilityProfile = isStereoStabilitySoundProfile(soundProfile);
  const accessoryQualityProfile = isAccessoryQualitySoundProfile(soundProfile);
  const airwashControlProfile = isAirwashControlSoundProfile(soundProfile);
  const staticCleanProfile = isStaticCleanSoundProfile(soundProfile);
  const cleanHandoffProfile = isCleanHandoffSoundProfile(soundProfile);
  const tuning = state.tuning;
  const clarity = cleanProfile ? tuning.clarity : 1;
  const muffling = cleanProfile ? tuning.muffling : 1;
  const brightnessWeight = cleanProfile ? tuning.exhaustBrightness : 1;
  const edgeWeight = cleanProfile ? tuning.combustionEdge : 1;
  const formantShift = cleanProfile ? tuning.exhaustFormantShift : 1;
  const lowOrderGain = cleanProfile ? tuning.lowOrderGain : 1;
  const bodyResonanceGain = cleanProfile ? tuning.bodyResonanceGain : 1;
  const bassShelf = cleanProfile ? tuning.bassShelf : 1;
  const pulseDensitySmoothing = cleanProfile ? tuning.pulseDensitySmoothing : 1;
  const spectralTilt = cleanProfile ? tuning.spectralTilt : 1;
  const rpmNorm = clamp(rpm / Math.max(quick.redline, 1), 0, 1.4);
  const perCylinder = state.analysis.perCylinderDisplacement;
  const power = (0.22 + throttle * 0.78) * (0.62 + load * 0.38);
  const openHeader = config.advanced?.exhaustRouting === "open-headers" ? 1.15 : 1;
  const headerUnequal = config.advanced?.headerGeometry === "unequal-length" ? 1 : 0;
  const cylinderCount = state.analysis.cylinderCount;
  const acoustic = state.analysis.acousticProfile;
  const exhaustMode = acoustic.resonanceModes.find((mode) => mode.name === "exhaust-quarter") ?? acoustic.resonanceModes[0];
  const bodyMode = acoustic.resonanceModes.find((mode) => mode.name === "block-body") ?? acoustic.resonanceModes[1] ?? exhaustMode;
  const primaryMode = acoustic.resonanceModes.find((mode) => mode.name === "primary-pipe") ?? acoustic.resonanceModes[2] ?? bodyMode;
  const tunedLowOrder = clamp((0.82 + acoustic.lowOrderEnergy * 0.58 + acoustic.bankRoughness * 0.26) * lowOrderGain, 0.45, 1.95);
  const tunedBody = clamp(acoustic.bodyResonanceGain * bodyResonanceGain, 0.45, 1.95);
  const tunedBass = clamp(acoustic.bassShelf * bassShelf, 0.45, 1.95);
  const tunedSmoothing = clamp(acoustic.pulseDensitySmoothing * pulseDensitySmoothing, 0.55, 1.75);
  const tunedTilt = clamp(acoustic.spectralTilt * spectralTilt, 0.45, 1.85);
  const highCylinderSmooth = cleanProfile
    ? cylinderBalanceProfile
      ? clamp(1.05 - Math.max(0, cylinderCount - 8) * 0.018 - (tunedSmoothing - 1) * 0.085, 0.78, 1.12)
      : clamp(1.06 - Math.max(0, cylinderCount - 8) * 0.044 - (tunedSmoothing - 1) * 0.12, 0.68, 1.12)
    : 1;
  const fewCylinderPunch = cleanProfile ? clamp(1 + Math.max(0, 6 - cylinderCount) * 0.040 - (tunedSmoothing - 1) * 0.05, 0.94, 1.20) : 1;
  const perEventEnergy = cleanProfile
    ? cylinderBalanceProfile
      ? clamp(Math.pow(8 / cylinderCount, 0.32), 0.82, 1.18)
      : clamp(Math.sqrt(8 / cylinderCount), 0.70, 1.22)
    : 1;
  const cylinderResonance = clarityProfile ? clamp(event.resonanceSkew ?? 1, 0.90, 1.10) : 1;
  const cylinderBodyBias = clarityProfile ? clamp(event.bodyBias ?? 1, 0.86, 1.14) : 1;
  const cylinderThroatBias = clarityProfile ? clamp(event.throatBias ?? 1, 0.80, 1.20) : 1;
  const cylinderBlowdownBias = clarityProfile ? clamp(event.blowdownBias ?? 1, 0.76, 1.24) : 1;
  const flatPlanePipe = quick.crankshaft === "flat-plane";
  const flatPlaneBright = flatPlanePipe ? 0.96 : 1;
  const layoutDepth = quick.layout === "flat" ? 0.92 : quick.layout === "inline" ? 1.05 : quick.layout === "radial" ? 0.82 : 1;
  const v12AirTrim = airwashControlProfile
    ? staticCleanProfile
      ? cleanHandoffProfile
        ? 0
        : clamp(0.010 + load * 0.020 + brightnessWeight * 0.008, 0.010, 0.045)
      : clamp(0.08 + load * 0.07 + brightnessWeight * 0.02, 0.08, 0.22)
    : accessoryQualityProfile ? clamp(0.66 + load * 0.16 + brightnessWeight * 0.04, 0.66, 0.90) : 1;
  const v12PresenceTrim = airwashControlProfile
    ? staticCleanProfile
      ? cleanHandoffProfile
        ? clamp(0.30 + load * 0.04, 0.30, 0.40)
        : clamp(0.42 + load * 0.06, 0.42, 0.54)
      : clamp(0.52 + load * 0.07, 0.52, 0.64)
    : accessoryQualityProfile ? clamp(0.80 + load * 0.10, 0.80, 0.91) : 1;
  const v12BodyLift = airwashControlProfile
    ? staticCleanProfile
      ? cleanHandoffProfile
        ? clamp(1.24 + load * 0.12, 1.24, 1.36)
        : clamp(1.16 + load * 0.10, 1.16, 1.26)
      : clamp(1.10 + load * 0.08, 1.10, 1.18)
    : accessoryQualityProfile ? clamp(1.04 + load * 0.06, 1.04, 1.10) : 1;
  const subHz = cleanProfile
    ? clamp(exhaustMode.frequencyHz * cylinderResonance * (1 + load * 0.07 + event.toneOffset * 0.006), 28, 135)
    : 38 + perCylinder * 42 + load * 12;
  const bodyHz = cleanProfile
    ? clamp(bodyMode.frequencyHz * layoutDepth * cylinderResonance * (1 + load * 0.09 + event.toneOffset * 0.010), 38, 145)
    : 46 + perCylinder * 58 + load * 18 + event.toneOffset * 4;
  const growlHz = cleanProfile
    ? clamp(primaryMode.frequencyHz * (quick.crankshaft === "flat-plane" ? 1.52 : quick.crankshaft === "cross-plane" ? 1.18 : 1.30) + bodyHz * 0.36, 90, 380)
    : bodyHz * (2.05 + event.toneOffset * 0.03);
  const pipeHz = cleanProfile
    ? clamp(
      (primaryMode.frequencyHz * (flatPlanePipe ? 2.78 : 2.34) +
        state.analysis.exhaustBrightness * (flatPlanePipe ? 360 : 320) +
        perCylinder * 46 +
        load * 38) *
        flatPlaneBright +
        event.toneOffset * (flatPlanePipe ? 120 : 65) +
        headerUnequal * event.toneOffset * 42,
      180,
      1250,
    ) * formantShift * cylinderResonance
    : 150 + state.analysis.exhaustBrightness * 360 + perCylinder * 52 + headerUnequal * event.toneOffset * 55;
  const presenceHz = cleanProfile
    ? clamp(pipeHz * (clarityProfile ? 2.45 : 2.05) + primaryMode.frequencyHz * 3.2 + event.toneOffset * 170, 850, 5200)
    : clamp(pipeHz * 1.9, 650, 4200);
  const presenceGain = cleanProfile
    ? clamp(
      (clarityProfile ? 2.15 : 0.72) *
        (0.48 + state.analysis.exhaustBrightness * 0.42 + load * 0.22) *
        clamp(clarity / Math.max(0.82, muffling), 0.58, 1.55) *
        v12PresenceTrim,
      0.18,
      2.20,
    )
    : 0.45;
  const airBurstGain = clarityProfile
    ? clamp((0.070 + state.analysis.exhaustBrightness * 0.085 + load * 0.045) * clamp(clarity / Math.max(0.86, muffling), 0.65, 1.55) * v12AirTrim, staticCleanProfile ? 0 : airwashControlProfile ? 0.006 : 0.026, 0.320)
    : 0;
  const pressureSkew = clarityProfile
    ? clamp(0.82 + load * 0.36 + state.analysis.exhaustBrightness * 0.18 + event.toneOffset * 0.06, 0.55, 1.42)
    : 1;
  const pipeChirp = clarityProfile
    ? (nextRandom(state) > 0.5 ? 1 : -1) *
      clamp(0.62 + state.analysis.exhaustBrightness * 0.64 + load * 0.42 + Math.abs(event.toneOffset) * 0.035, 0.35, 2.15)
    : 0;
  const throatGain = clarityProfile
    ? clamp((0.028 + state.analysis.exhaustBrightness * 0.034 + load * 0.024) * cylinderThroatBias * clamp(clarity / Math.max(0.82, muffling), 0.62, 1.45), 0.018, 0.115)
    : 0;
  const blowdownGain = clarityProfile
    ? clamp(
      (0.026 + state.analysis.exhaustBrightness * 0.044 + load * 0.030 + (config.advanced?.exhaustRouting === "open-headers" ? 0.014 : 0)) *
        cylinderBlowdownBias *
        clamp(clarity / Math.max(0.82, muffling), 0.62, 1.45),
      0.014,
      0.135,
    )
    : 0;
  const blowdownPhase = clarityProfile ? nextRandom(state) * TWO_PI : 0;
  const radiationGain = clarityProfile
    ? clamp(
      (0.018 + state.analysis.exhaustBrightness * 0.030 + load * 0.022 + (config.advanced?.exhaustRouting === "open-headers" ? 0.012 : 0)) *
        cylinderBlowdownBias *
        clamp(clarity / Math.max(0.84, muffling), 0.62, 1.45) *
        v12AirTrim,
      staticCleanProfile ? 0 : airwashControlProfile ? 0.0025 : 0.010,
      0.105,
    )
    : 0;
  const radiationPhase = clarityProfile ? nextRandom(state) * TWO_PI : 0;
  const pipeTravelSec = clarityProfile ? (acoustic.geometry.exhaustLengthCm / 100) / 343 : 0;
  const reflectionDelayA = clarityProfile
    ? clamp(pipeTravelSec * (0.38 + nextRandom(state) * 0.16) + event.pipeDelaySec * 0.45, 0.0012, 0.0075)
    : 0;
  const reflectionDelayB = clarityProfile
    ? clamp(pipeTravelSec * (0.72 + nextRandom(state) * 0.24) + event.pipeDelaySec * 0.70, 0.0024, 0.0140)
    : 0;
  const reflectionGain = clarityProfile
    ? clamp(
      (0.26 + state.analysis.exhaustBrightness * 0.18 + load * 0.16) *
        (config.advanced?.exhaustRouting === "open-headers" ? 1.28 : 1) /
        Math.sqrt(Math.max(0.7, acoustic.geometry.mufflerVolumeL / 12)),
      0.10,
      0.62,
    )
    : 0;
  const scatterHzA = clarityProfile ? clamp(presenceHz * (0.72 + nextRandom(state) * 0.86), 1200, 7400) : presenceHz;
  const scatterHzB = clarityProfile ? clamp(presenceHz * (1.18 + nextRandom(state) * 1.10), 1600, 9000) : presenceHz * 1.57;
  const scatterPhaseA = clarityProfile ? nextRandom(state) * TWO_PI : 0;
  const scatterPhaseB = clarityProfile ? nextRandom(state) * TWO_PI : 0;
  const decaySec = cleanProfile
    ? clamp(
      (0.042 + perCylinder * 0.016 - rpmNorm * 0.018 + (fewCylinderPunch - 1) * 0.016 + (tunedBass - 1) * 0.010 + (tunedSmoothing - 1) * 0.012 - (1 - highCylinderSmooth) * 0.006) *
        clamp(1 + (muffling - 1) * 0.20 - (clarity - 1) * 0.10, 0.82, 1.18),
      0.013,
      0.092,
    )
    : clamp(0.046 + perCylinder * 0.018 - rpmNorm * 0.017, 0.016, 0.080);
  const crackle = cleanProfile
    ? (0.065 + state.analysis.exhaustBrightness * 0.18) *
      (config.advanced?.exhaustRouting === "open-headers" ? 1.35 : 1) *
      clamp(edgeWeight * clarity / Math.max(0.7, muffling), 0.45, 1.65) *
      (accessoryQualityProfile ? clamp(0.72 + load * 0.12, 0.70, 0.86) : 1)
    : 0.18 + state.analysis.exhaustBrightness * 0.38 + (config.advanced?.exhaustRouting === "open-headers" ? 0.08 : 0);
  const combustionVariance = cleanProfile ? 1 + (nextRandom(state) - 0.5) * 0.10 : 1;
  const microDelaySec = cleanProfile ? (nextRandom(state) - 0.5) * 0.00022 : 0;
  const resonatorDrift = cleanProfile ? 1 + (nextRandom(state) - 0.5) * (0.045 + brightnessWeight * 0.012) : 1;
  const startupTransientLift = clarityProfile && state.crankAngleDeg < 1440 ? 1.10 : 1;

  state.pulses.push({
    ageSec: -(event.pipeDelaySec + microDelaySec),
    amp: event.amplitude *
      power *
      state.analysis.exhaustGain *
      openHeader *
      startupTransientLift *
      (cleanProfile ? fewCylinderPunch * highCylinderSmooth * perEventEnergy : 1) *
      combustionVariance *
      clamp(0.92 + clarity * 0.10 - muffling * 0.04, 0.78, 1.14),
    pan: event.pan,
    decaySec,
    subHz,
    subGain: cleanProfile ? tunedBass * tunedLowOrder * exhaustMode.gain * (0.52 + load * 0.48) * v12BodyLift : 0.75,
    bodyHz,
    bodyGain: cleanProfile ? tunedBody * bodyMode.gain * (0.78 + load * 0.30) * cylinderBodyBias * v12BodyLift : 1,
    growlHz,
    pipeHz: pipeHz * resonatorDrift,
    pipeGain: cleanProfile ? primaryMode.gain * clamp(1.18 - (tunedTilt - 1) * 0.25 + brightnessWeight * 0.08, 0.65, 1.35) : 1,
    presenceHz: presenceHz * (clarityProfile ? 1 + (nextRandom(state) - 0.5) * 0.160 : 1),
    presenceGain,
    scatterHzA,
    scatterHzB,
    scatterPhaseA,
    scatterPhaseB,
    airBurstGain,
    pressureSkew,
    previousPressure: 0,
    pipeChirp,
    throatGain,
    throatNoise: 0,
    throatNoiseLow: 0,
    blowdownGain,
    blowdownPhase,
    radiationGain,
    radiationPhase,
    radiationNoise: 0,
    radiationNoiseLow: 0,
    reflectionDelayA,
    reflectionDelayB,
    reflectionGain,
    airNoise: 0,
    airNoiseLow: 0,
    crackle,
    toneOffset: event.toneOffset,
  });

  if (clarityProfile) {
    const eventStrength = event.amplitude * power * (0.52 + load * 0.48) * clamp(state.analysis.exhaustGain, 0.55, 1.35);
    state.combustionEnvelope = clamp(state.combustionEnvelope + eventStrength * 0.105, 0, 1.20);
    state.combustionEdgeEnvelope = clamp(state.combustionEdgeEnvelope + eventStrength * 0.48, 0, 1.65);
    const cylinderIdentity = clamp(0.92 + Math.abs(event.toneOffset) * 0.035 + (cylinderThroatBias - 1) * 0.18, 0.82, 1.20);
    const mechanicalStrike = eventStrength *
      (0.18 + rpmNorm * 0.16) *
      cylinderIdentity *
      clamp(1.12 - tunedSmoothing * 0.08 + acoustic.bankRoughness * 0.10, 0.78, 1.18);
    state.mechanicalTickEnvelope = clamp(state.mechanicalTickEnvelope + mechanicalStrike, 0, 1.70);
  }

  const maxActivePulses = cleanProfile
    ? stereoStabilityProfile
      ? cylinderCount >= 10 ? (rpmNorm > 0.88 ? 46 : 58) : rpmNorm > 0.88 ? 40 : 48
      : cylinderBalanceProfile
        ? cylinderCount >= 10 ? (rpmNorm > 0.88 ? 58 : 64) : rpmNorm > 0.88 ? 42 : 48
      : cylinderCount >= 10 ? 28 : rpmNorm > 0.88 ? 34 : 44
    : 64;
  if (state.pulses.length > maxActivePulses) {
    state.pulses.splice(0, state.pulses.length - maxActivePulses);
  }
}

function rpmAtSample(progress: number, config: EngineConfiguration, options: Required<Pick<EngineRenderOptions, "startRpm" | "endRpm" | "profile">>) {
  if (options.profile === "steady") return options.endRpm;
  const start = options.startRpm;
  const end = options.endRpm;

  if (options.profile === "acceleration") {
    const shifted = progress < 0.38 ? progress / 0.38 : progress < 0.66 ? (progress - 0.38) / 0.28 : (progress - 0.66) / 0.34;
    const local = clamp(shifted, 0, 1);
    const gearDrop = progress < 0.38 ? 0 : progress < 0.66 ? 0.22 : 0.38;
    return start + (end - start) * (gearDrop + local * (1 - gearDrop));
  }

  if (progress < 0.78) {
    const eased = progress / 0.78;
    return start + (end - start) * (eased * eased * (3 - 2 * eased));
  }

  const down = (progress - 0.78) / 0.22;
  return end - (end - start) * clamp(down, 0, 1) * 0.72;
}

function synthesizeSample(state: SynthesisState, config: EngineConfiguration, rpm: number, throttle: number, load: number): [number, number] {
  const { quick, forcedInduction } = config;
  const sr = state.sampleRate;
  const soundProfile = normalizeSoundProfile(config.soundProfile);
  const cleanProfile = !isBaselineSoundProfile(soundProfile);
  const clarityProfile = isClaritySoundProfile(soundProfile);
  const cylinderBalanceProfile = isCylinderBalanceSoundProfile(soundProfile);
  const stereoStabilityProfile = isStereoStabilitySoundProfile(soundProfile);
  const accessoryQualityProfile = isAccessoryQualitySoundProfile(soundProfile);
  const airwashControlProfile = isAirwashControlSoundProfile(soundProfile);
  const staticCleanProfile = isStaticCleanSoundProfile(soundProfile);
  const cleanHandoffProfile = isCleanHandoffSoundProfile(soundProfile);
  const tuning = state.tuning;
  const clarity = cleanProfile ? tuning.clarity : 1;
  const muffling = cleanProfile ? tuning.muffling : 1;
  const brightnessWeight = cleanProfile ? tuning.exhaustBrightness : 1;
  const edgeWeight = cleanProfile ? tuning.combustionEdge : 1;
  const orderWeight = cleanProfile ? tuning.orderHarmonicGain : 1;
  const intakeTexture = cleanProfile ? tuning.intakeTexture : 1;
  const turboWhoosh = cleanProfile ? tuning.turboWhoosh : 1;
  const turboTone = cleanProfile ? tuning.turboTone : 1;
  const superchargerWhine = cleanProfile ? tuning.superchargerWhine : 1;
  const lowOrderGain = cleanProfile ? tuning.lowOrderGain : 1;
  const bodyResonanceGain = cleanProfile ? tuning.bodyResonanceGain : 1;
  const bassShelf = cleanProfile ? tuning.bassShelf : 1;
  const spectralTilt = cleanProfile ? tuning.spectralTilt : 1;
  const acoustic = state.analysis.acousticProfile;
  const intakeMode = acoustic.resonanceModes.find((mode) => mode.name === "intake-runner") ?? acoustic.resonanceModes[3] ?? acoustic.resonanceModes[0];
  const rpmNorm = clamp(rpm / Math.max(quick.redline, 1), 0, 1.3);
  const crankDegreesPerSample = (rpm * 6) / sr;
  state.crankAngleDeg += crankDegreesPerSample;

  while (state.nextFireAbsDeg <= state.crankAngleDeg) {
    const event = state.analysis.events[state.eventIndex % state.analysis.events.length];
    addPulse(state, config, event, rpm, throttle, load);
    state.nextFireAbsDeg += event.intervalDeg;
    state.eventIndex = (state.eventIndex + 1) % state.analysis.events.length;
  }

  if (state.crankAngleDeg > 720000) {
    state.crankAngleDeg -= 720000;
    state.nextFireAbsDeg -= 720000;
  }

  let left = 0;
  let right = 0;
  const denseStereoWidth = stereoStabilityProfile && state.analysis.cylinderCount >= 10
    ? clamp(0.48 - Math.max(0, state.analysis.cylinderCount - 8) * 0.055 - Math.max(0, rpmNorm - 0.65) * 0.22, 0.16, 0.48)
    : 1;

  for (let i = state.pulses.length - 1; i >= 0; i--) {
    const pulse = state.pulses[i];
    if (
      !Number.isFinite(pulse.amp) ||
      !Number.isFinite(pulse.pan) ||
      !Number.isFinite(pulse.decaySec) ||
      pulse.decaySec <= 0
    ) {
      state.pulses.splice(i, 1);
      continue;
    }

    pulse.ageSec += 1 / sr;
    if (pulse.ageSec < 0) continue;

    const age = pulse.ageSec;
    const highRpmStableDetail = stereoStabilityProfile && state.analysis.cylinderCount >= 10 && rpmNorm > 0.92;
    const realtimeLeanDetail = clarityProfile && !cylinderBalanceProfile && (state.analysis.cylinderCount >= 10 || rpmNorm > 0.82);
    const earlyDetail = clarityProfile && age < (highRpmStableDetail ? 0.018 : realtimeLeanDetail ? 0.018 : cylinderBalanceProfile && state.analysis.cylinderCount >= 10 ? 0.023 : 0.026);
    const transientDetail = clarityProfile && age < (highRpmStableDetail ? 0.036 : realtimeLeanDetail ? 0.036 : cylinderBalanceProfile && state.analysis.cylinderCount >= 10 ? 0.047 : 0.052);
    const attack = 1 - Math.exp(-age / 0.00045);
    const env = attack * Math.exp(-age / pulse.decaySec);
    const subEnv = attack * Math.exp(-age / (pulse.decaySec * (cleanProfile ? 1.82 : 1.25)));
    const crackEnv = Math.exp(-age / 0.0045);
    const pipeEnv = Math.exp(-age / (pulse.decaySec * (cleanProfile ? 0.38 : 0.65)));
    const presenceEnv = Math.exp(-age / (clarityProfile ? 0.0095 : 0.0062));
    const bodyGain = cleanProfile ? clamp(1.04 + (muffling - 1) * 0.16 - (clarity - 1) * 0.06, 0.78, 1.24) : 1;
    const pipeGain = cleanProfile
      ? clamp((clarityProfile ? 1.96 : 0.74) + brightnessWeight * 0.20 + clarity * 0.16 - muffling * 0.10, 0.45, 2.55)
      : 1;
    const eventEdgeGain = cleanProfile ? clamp(edgeWeight * clarity / Math.max(0.72, muffling), 0.42, 1.72) : 1;
    const smoothTransient = cleanProfile
      ? stereoStabilityProfile
        ? clamp(1.02 - (acoustic.pulseDensitySmoothing - 1) * 0.38 - Math.max(0, state.analysis.cylinderCount - 8) * (rpmNorm > 0.90 ? 0.034 : 0.026), 0.54, 1.10)
        : cylinderBalanceProfile
          ? clamp(1.02 - (acoustic.pulseDensitySmoothing - 1) * 0.34 - Math.max(0, state.analysis.cylinderCount - 8) * 0.026, 0.58, 1.10)
        : clamp(1.02 - (acoustic.pulseDensitySmoothing - 1) * 0.45 - Math.max(0, state.analysis.cylinderCount - 8) * 0.060, 0.48, 1.10)
      : 1;
    let pressureStep = 0;
    if (!clarityProfile || transientDetail) {
      const pressureRise = Math.exp(-age / (clarityProfile ? 0.0026 : 0.003)) - Math.exp(-age / (clarityProfile ? 0.00034 : 0.00055));
      const pressureTail = clarityProfile ? (Math.exp(-age / 0.013) - Math.exp(-age / 0.0022)) * 0.22 * pulse.pressureSkew : 0;
      pressureStep = (pressureRise - pressureTail) * (cleanProfile ? (clarityProfile ? 0.66 : 0.58) : 0.52) * clamp(0.84 + edgeWeight * 0.18, 0.55, 1.35) * smoothTransient;
    }
    const eventBodyLift = clarityProfile ? 1.24 : 1;
    const sub = Math.sin(TWO_PI * pulse.subHz * age + pulse.toneOffset * 0.35) * (cleanProfile ? 0.30 : 0.18) * pulse.subGain * bodyGain * eventBodyLift;
    const body = Math.sin(TWO_PI * pulse.bodyHz * age + pulse.toneOffset) * (cleanProfile ? 0.56 : 0.56) * bodyGain * pulse.bodyGain * eventBodyLift;
    const growl = Math.sin(TWO_PI * pulse.growlHz * age + pulse.toneOffset * 0.7) * (cleanProfile ? 0.24 : 0.22) * bodyGain * pulse.bodyGain * (clarityProfile ? 1.06 : 1);
    const chirpPhase = clarityProfile
      ? cleanHandoffProfile ? 0 : pulse.pipeChirp * (1 - Math.exp(-age / 0.0009)) * Math.exp(-age / 0.015) * (0.74 + pulse.pressureSkew * 0.18)
      : 0;
    const pressureDetune = clarityProfile ? cleanHandoffProfile ? 1 : 1 + Math.tanh(pressureStep * 1.8) * 0.012 * pulse.pressureSkew : 1;
    const pipePhase = TWO_PI * pulse.pipeHz * age * pressureDetune + chirpPhase;
    const pipe = cleanProfile
      ? pipeEnv * (
        Math.sin(pipePhase + pulse.toneOffset * 1.3) * (clarityProfile ? cleanHandoffProfile ? 0.072 : 0.092 : 0.09) +
        Math.sin(pipePhase * 1.41 + pulse.toneOffset * 0.31 - chirpPhase * 0.34) * (clarityProfile ? cleanHandoffProfile ? 0.028 : 0.068 : 0.065) +
        Math.sin(pipePhase * 2.03 + pulse.toneOffset * 1.7 + chirpPhase * 0.21) * (clarityProfile ? cleanHandoffProfile ? 0.010 : 0.042 : 0.04)
      ) * pipeGain * pulse.pipeGain
      : Math.sin(TWO_PI * pulse.pipeHz * age) * pipeEnv * 0.22;
    const blowdownEnv = clarityProfile
      ? transientDetail
        ? (Math.exp(-age / 0.0034) - Math.exp(-age / 0.00022)) * clamp(0.72 + load * 0.34 + edgeWeight * 0.16, 0.68, 1.24)
        : 0
      : 0;
    const blowdownPhase = clarityProfile ? pipePhase * 0.62 + pulse.blowdownPhase + Math.tanh(pressureStep * 2.2) * 0.72 : 0;
    const blowdownCore = clarityProfile
      ? Math.sin(blowdownPhase) * 0.86 +
        Math.sin(blowdownPhase * 1.91 + pulse.toneOffset * 0.21) * 0.38 +
        Math.sin(blowdownPhase * 3.08 - pulse.toneOffset * 0.33) * 0.20
      : 0;
    const blowdownFold = clarityProfile
      ? Math.tanh((blowdownCore + Math.max(0, pressureStep) * (cleanHandoffProfile ? 0.42 + pulse.pressureSkew * 0.10 : 0.82 + pulse.pressureSkew * 0.24)) * (cleanHandoffProfile ? 1.25 + pulse.pressureSkew * 0.18 : 2.20 + pulse.pressureSkew * 0.35))
      : 0;
    const blowdownPressure = clarityProfile ? Math.max(0, pressureStep) * (0.36 + pulse.pressureSkew * 0.12) : 0;
    const blowdownBark = clarityProfile
      ? (blowdownFold * (cleanHandoffProfile ? 0.30 : 0.58) + Math.max(0, blowdownFold) * (cleanHandoffProfile ? 0.12 : 0.30) - Math.max(0, -blowdownFold) * 0.04 + blowdownPressure * (cleanHandoffProfile ? 0.58 : 1)) *
        blowdownEnv *
        pulse.blowdownGain *
        eventEdgeGain *
        smoothTransient
      : 0;
    let exhaustRadiation = 0;
    if (clarityProfile && transientDetail) {
      pulse.radiationNoise = pulse.radiationNoise * (staticCleanProfile ? 0.70 : airwashControlProfile ? 0.52 : 0.18) + (nextRandom(state) - 0.5) * (staticCleanProfile ? 0 : airwashControlProfile ? 0.18 : 0.82);
      pulse.radiationNoiseLow = pulse.radiationNoiseLow * (airwashControlProfile ? 0.92 : 0.82) + pulse.radiationNoise * (airwashControlProfile ? 0.08 : 0.18);
      const radiatedNoise = staticCleanProfile ? 0 : pulse.radiationNoise - pulse.radiationNoiseLow * 0.36;
      const radiationEnv = (Math.exp(-age / (staticCleanProfile ? 0.0015 : airwashControlProfile ? 0.0022 : 0.0054)) - Math.exp(-age / 0.00024)) * clamp(0.70 + load * 0.36 + edgeWeight * 0.16, 0.66, 1.24);
      const pressureRadiance = Math.min(1, Math.abs(pressureStep) * 1.8 + Math.abs(blowdownBark) * 4.8);
      const directivityFlutter = cleanHandoffProfile ? 0 :
        Math.sin(TWO_PI * pulse.presenceHz * 0.42 * age + pulse.radiationPhase) * (staticCleanProfile ? 0.045 : airwashControlProfile ? 0.12 : 0.28) +
        Math.sin(TWO_PI * pulse.pipeHz * 2.70 * age + pulse.radiationPhase * 0.47) * (staticCleanProfile ? 0.025 : airwashControlProfile ? 0.08 : 0.16);
      exhaustRadiation = (radiatedNoise * (airwashControlProfile ? 0.22 : 0.76) + directivityFlutter * ((cleanHandoffProfile ? 0 : staticCleanProfile ? 0.045 : airwashControlProfile ? 0.16 : 0.28) + pressureRadiance * (cleanHandoffProfile ? 0 : staticCleanProfile ? 0.035 : airwashControlProfile ? 0.16 : 0.24))) *
        radiationEnv *
        pulse.radiationGain *
        eventEdgeGain *
        smoothTransient;
    }
    const dryPresence = cleanProfile
      ? (clarityProfile && !transientDetail) ? 0 : presenceEnv * pulse.presenceGain * (
        Math.sin(TWO_PI * pulse.presenceHz * age + pulse.toneOffset * 1.9) * (clarityProfile ? 0.018 : 0.014) +
        Math.sin(TWO_PI * pulse.presenceHz * 1.57 * age + pulse.toneOffset * 0.4) * (clarityProfile ? 0.022 : 0.007) +
        Math.sin(TWO_PI * pulse.presenceHz * 2.11 * age + pulse.toneOffset * 2.2) * (clarityProfile ? 0.016 : 0.004) +
        (clarityProfile && !cleanHandoffProfile ? Math.sin(TWO_PI * pulse.scatterHzA * age + pulse.scatterPhaseA) * (airwashControlProfile ? 0.006 : 0.024) : 0) +
        (clarityProfile && !cleanHandoffProfile ? Math.sin(TWO_PI * pulse.scatterHzB * age + pulse.scatterPhaseB) * (airwashControlProfile ? 0.004 : 0.018) : 0)
      ) * (cleanHandoffProfile ? 0.34 : staticCleanProfile ? 0.50 : airwashControlProfile ? 0.62 : 1)
      : 0;
    let airBurst = 0;
    if (clarityProfile && earlyDetail) {
      pulse.airNoise = pulse.airNoise * (staticCleanProfile ? 0.78 : airwashControlProfile ? 0.66 : 0.46) + (nextRandom(state) - 0.5) * (staticCleanProfile ? 0 : airwashControlProfile ? 0.16 : 0.54);
      pulse.airNoiseLow = pulse.airNoiseLow * (airwashControlProfile ? 0.96 : 0.92) + pulse.airNoise * (airwashControlProfile ? 0.04 : 0.08);
      const turbulentAir = staticCleanProfile ? 0 : pulse.airNoise - pulse.airNoiseLow * 0.72;
      const airEnv = (Math.exp(-age / (staticCleanProfile ? 0.0014 : airwashControlProfile ? 0.0028 : 0.010)) - Math.exp(-age / 0.00042)) * (0.62 + throttle * 0.38);
      airBurst = turbulentAir * airEnv * pulse.airBurstGain * eventEdgeGain * smoothTransient;
    }
    const airwashNoiseGate = airwashControlProfile
      ? staticCleanProfile
        ? cleanHandoffProfile
          ? clamp(Math.min(1, Math.abs(pressureStep) * 2.4 + Math.abs(blowdownBark) * 3.8) * 0.08 + load * 0.010, 0.004, 0.10)
          : clamp(Math.min(1, Math.abs(pressureStep) * 3.2 + Math.abs(blowdownBark) * 5.2) * 0.16 + load * 0.025, 0.010, 0.20)
        : clamp(0.10 + Math.min(1, Math.abs(pressureStep) * 2.8 + Math.abs(blowdownBark) * 5.2) * 0.32 + load * 0.12, 0.10, 0.54)
      : 1;
    const rasp = clarityProfile
      ? earlyDetail ? (staticCleanProfile ? 0 : (nextRandom(state) - 0.5) * presenceEnv * pulse.crackle * (airwashControlProfile ? 0.055 : 0.220) * eventEdgeGain * smoothTransient) : 0
      : 0;
    let throatPulse = 0;
    if (clarityProfile && earlyDetail) {
      pulse.throatNoise = pulse.throatNoise * (staticCleanProfile ? 0.72 : 0.22) + (nextRandom(state) - 0.5) * (staticCleanProfile ? 0 : 0.78);
      pulse.throatNoiseLow = pulse.throatNoiseLow * 0.74 + pulse.throatNoise * 0.26;
      const throatTexture = staticCleanProfile ? 0 : pulse.throatNoise - pulse.throatNoiseLow * 0.42;
      const throatEnv = (Math.exp(-age / 0.0042) - Math.exp(-age / 0.00032)) * clamp(0.78 + edgeWeight * 0.18 + load * 0.16, 0.72, 1.24);
      const throatFold = Math.tanh((pressureStep + chirpPhase * 0.12 + throatTexture * 0.68) * 2.7);
      throatPulse = (throatTexture * 0.70 + throatFold * 0.30) * throatEnv * pulse.throatGain * eventEdgeGain * smoothTransient * (cleanHandoffProfile ? 0.08 : staticCleanProfile ? 0.26 : airwashControlProfile ? 0.42 : 1);
    }
    const crack = (!clarityProfile || earlyDetail)
      ? staticCleanProfile ? 0 : (nextRandom(state) - 0.5) * crackEnv * pulse.crackle * (cleanProfile ? (clarityProfile ? (airwashControlProfile ? 0.12 : 0.42) : 0.58) + throttle * (airwashControlProfile ? 0.08 : 0.32) : 1) * eventEdgeGain * smoothTransient
      : 0;
    let pipeReflection = 0;
    if (clarityProfile && transientDetail) {
      const reflectionAgeA = age - pulse.reflectionDelayA;
      const reflectionAgeB = age - pulse.reflectionDelayB;
      if (reflectionAgeA > 0) {
        const tapA = (Math.exp(-reflectionAgeA / 0.0048) - Math.exp(-reflectionAgeA / 0.00042));
        pipeReflection += tapA * pulse.reflectionGain * 0.34 * Math.sin(TWO_PI * pulse.pipeHz * 0.46 * reflectionAgeA + pulse.toneOffset);
      }
      if (reflectionAgeB > 0) {
        const tapB = (Math.exp(-reflectionAgeB / 0.0072) - Math.exp(-reflectionAgeB / 0.00070));
        pipeReflection -= tapB * pulse.reflectionGain * 0.22 * Math.sin(TWO_PI * pulse.pipeHz * 0.32 * reflectionAgeB + pulse.toneOffset * 0.4);
      }
    }
    const edge = cleanProfile
      ? (!clarityProfile || earlyDetail)
        ? (Math.exp(-age / 0.0021) - Math.exp(-age / 0.00028)) * ((clarityProfile ? (cleanHandoffProfile ? 0.035 : staticCleanProfile ? 0.070 : airwashControlProfile ? 0.105 : 0.165) : 0.12) + state.analysis.exhaustBrightness * (cleanHandoffProfile ? 0.014 : staticCleanProfile ? 0.030 : airwashControlProfile ? 0.055 : 0.10)) * eventEdgeGain * smoothTransient
        : 0
      : 0;
    const nonlinearBite = clarityProfile && transientDetail ? Math.tanh((pressureStep + pipeReflection + dryPresence * 0.55) * 2.4) * 0.045 : 0;
    const pressureCore = pressureStep + pipeReflection + nonlinearBite + dryPresence * 0.42 + airBurst * 0.58 + throatPulse * 0.74 + blowdownBark * 0.92 + exhaustRadiation * 0.80;
    const pressureDelta = clarityProfile ? pressureCore - pulse.previousPressure : 0;
    pulse.previousPressure = pressureCore;
    const snapEnv = clarityProfile ? Math.exp(-age / 0.0048) * clamp(1 - age / 0.021, 0, 1) : 0;
    const pressureSnap = clarityProfile
      ? earlyDetail ? Math.tanh(pressureDelta * 7.2) *
        snapEnv *
        pulse.presenceGain *
        (cleanHandoffProfile ? 0.012 + state.analysis.exhaustBrightness * 0.006 + load * 0.003 : 0.027 + state.analysis.exhaustBrightness * 0.014 + load * 0.007) *
        eventEdgeGain *
        smoothTransient *
        (cleanHandoffProfile ? 0.22 : staticCleanProfile ? 0.40 : airwashControlProfile ? 0.62 : 1) : 0
      : 0;
    const pressureGrain = clarityProfile
      ? earlyDetail && !staticCleanProfile ? (nextRandom(state) - 0.5) *
        Math.min(1, Math.abs(pressureDelta) * 6.0) *
        snapEnv *
        pulse.airBurstGain *
        (airwashControlProfile ? 0.018 : 0.085) *
        eventEdgeGain *
        smoothTransient : 0
      : 0;
    const controlledAirBurst = airBurst * airwashNoiseGate;
    const controlledRadiation = exhaustRadiation * airwashNoiseGate;
    const controlledRasp = rasp * airwashNoiseGate;
    const controlledCrack = crack * airwashNoiseGate;
    const controlledPressureGrain = pressureGrain * airwashNoiseGate;
    const sample = pulse.amp * (subEnv * sub + env * (body + growl) + pipe + dryPresence + controlledAirBurst + throatPulse + blowdownBark + controlledRadiation + controlledRasp + controlledCrack + pressureStep + pipeReflection + nonlinearBite + edge + pressureSnap + controlledPressureGrain);
    const pulsePan = clamp(pulse.pan * denseStereoWidth, -0.72, 0.72);
    const leftGain = Math.sqrt((1 - pulsePan) * 0.5);
    const rightGain = Math.sqrt((1 + pulsePan) * 0.5);
    left += sample * leftGain;
    right += sample * rightGain;

    const maxPulseAge = clarityProfile
      ? stereoStabilityProfile && state.analysis.cylinderCount >= 10 ? (rpmNorm > 0.92 ? 0.066 : 0.084) : cylinderBalanceProfile && state.analysis.cylinderCount >= 10 ? 0.092 : state.analysis.cylinderCount >= 10 ? 0.070 : rpmNorm > 0.86 ? 0.082 : 0.105
      : 0.16;
    const minUsefulEnvelope = stereoStabilityProfile ? (state.analysis.cylinderCount >= 10 && rpmNorm > 0.92 ? 0.00070 : 0.00042) : cylinderBalanceProfile ? 0.00042 : realtimeLeanDetail ? 0.0012 : 0.0006;
    if (env < minUsefulEnvelope || age > maxPulseAge) {
      state.pulses.splice(i, 1);
    }
  }

  if (clarityProfile) {
    state.combustionEnvelope *= Math.exp(-1 / (sr * 0.033));
    state.combustionEdgeEnvelope *= Math.exp(-1 / (sr * 0.010));
    state.mechanicalTickEnvelope *= Math.exp(-1 / (sr * 0.012));
  } else {
    state.combustionEnvelope = 0;
    state.combustionEdgeEnvelope = 0;
    state.mechanicalTickEnvelope = 0;
  }

  const pulseConditionedSupport = clarityProfile ? clamp(0.26 + state.combustionEnvelope * 0.72, 0.26, 1.04) : 1;
  const edgeConditionedSupport = clarityProfile ? clamp(0.50 + state.combustionEdgeEnvelope * 0.40, 0.50, 1.16) : 1;

  const cycleHz = Math.max(0.5, calculateFourStrokeCycleRate(rpm));
  state.rumblePhase += TWO_PI * cycleHz / sr;
  state.intakePhase += TWO_PI * (rpm / 60) * (quick.aspiration === "na" ? 1.15 : 0.95) / sr;
  state.intakeResonancePhase += TWO_PI * clamp(intakeMode.frequencyHz * (0.74 + throttle * 0.30 + rpmNorm * (cleanHandoffProfile ? 0.04 : staticCleanProfile ? 0.08 : 0.18)), 110, 2200) / sr;
  state.mechPhase += TWO_PI * (rpm / 60) * 6 / sr;

  if (state.rumblePhase > TWO_PI) state.rumblePhase -= TWO_PI;
  if (state.intakePhase > TWO_PI) state.intakePhase -= TWO_PI;
  if (state.intakeResonancePhase > TWO_PI) state.intakeResonancePhase -= TWO_PI;
  if (state.mechPhase > TWO_PI) state.mechPhase -= TWO_PI;

  const idleLope = rpm < 1300 ? Math.sin(state.rumblePhase * 1.35) * state.analysis.idleInstability * (1 - rpmNorm) : 0;
  const cylinderRoughness = cleanProfile ? clamp(1.20 - acoustic.pulseDensitySmoothing * 0.16 + acoustic.bankRoughness * 0.18, 0.62, 1.35) : 1;
  const lowOrderDrive = cleanProfile
    ? clamp((0.64 + acoustic.lowOrderEnergy * 0.62 + acoustic.bankRoughness * 0.34) * lowOrderGain * bassShelf * bodyResonanceGain, 0.35, 1.95)
    : 1;
  const rumbleCarrier =
    Math.sin(state.rumblePhase * 2 + 0.18) * 0.48 +
    Math.sin(state.rumblePhase * 3 + 1.1) * 0.30 +
    Math.sin(state.rumblePhase * 4 + 0.43) * 0.22;
  const rumble = rumbleCarrier * (0.0045 + load * 0.010) * cylinderRoughness * lowOrderDrive * (1 + idleLope * 5);
  const denseSmooth = cleanProfile ? clamp((acoustic.pulseDensitySmoothing - 1) * (state.analysis.cylinderCount / 8), 0, 0.85) : 0;
  const densityBed = denseSmooth > 0
    ? (
      Math.sin(state.rumblePhase * state.analysis.cylinderCount + 0.41) * 0.55 +
      Math.sin(state.rumblePhase * state.analysis.cylinderCount * 1.5 + 1.2) * 0.25
    ) * (0.002 + load * 0.006) * denseSmooth * clamp(1.14 - acoustic.bankRoughness * 0.22, 0.72, 1.16) * (clarityProfile ? (cylinderBalanceProfile ? 0.34 : 0.22) * pulseConditionedSupport : 1)
    : 0;
  if (cleanProfile) {
    const intakeNoiseInput = nextRandom(state) - 0.5;
    state.intakeNoise = accessoryQualityProfile
      ? state.intakeNoise * (staticCleanProfile ? 0.985 : airwashControlProfile ? 0.94 : 0.82) + intakeNoiseInput * (staticCleanProfile ? 0 : airwashControlProfile ? 0.06 : 0.18)
      : state.intakeNoise * 0.94 + intakeNoiseInput * 0.06;
    state.intakeNoiseLow = accessoryQualityProfile
      ? state.intakeNoiseLow * (staticCleanProfile ? 0.998 : airwashControlProfile ? 0.996 : 0.988) + state.intakeNoise * (staticCleanProfile ? 0.002 : airwashControlProfile ? 0.004 : 0.012)
      : state.intakeNoiseLow * 0.94 + state.intakeNoise * 0.06;
  } else {
    state.intakeNoise = state.intakeNoise * 0.985 + (nextRandom(state) - 0.5) * 0.03;
    state.intakeNoiseLow = state.intakeNoiseLow * 0.985 + state.intakeNoise * 0.015;
  }
  const intakePulse = Math.max(0, Math.sin(state.intakePhase + idleLope * 5));
  const intakeCharacterLift = cylinderBalanceProfile ? clamp(0.72 + state.analysis.intakeGain * 1.80, 0.85, 1.75) : 1;
  const inductionWorkGate = accessoryQualityProfile
    ? clamp(0.045 + state.combustionEnvelope * 0.34 + Math.pow(Math.max(0, throttle * load), 0.88) * 0.42 + intakePulse * 0.07, 0.05, 0.88)
    : 1;
  const inductionBodyMakeup = airwashControlProfile ? clamp(1.08 + load * 0.10, 1.08, 1.18) : accessoryQualityProfile ? clamp(1.04 + load * 0.08, 1.04, 1.12) : 1;
  const intakeTextureNoise = staticCleanProfile ? 0 : accessoryQualityProfile ? state.intakeNoise - state.intakeNoiseLow * (airwashControlProfile ? 0.92 : 0.82) : state.intakeNoise;
  const intakeRpmGain = cleanHandoffProfile ? (0.032 + Math.pow(rpmNorm, 0.50) * 0.035) : staticCleanProfile ? (0.06 + Math.pow(rpmNorm, 0.50) * 0.070) : airwashControlProfile ? (0.08 + Math.pow(rpmNorm, 0.55) * 0.10) : accessoryQualityProfile ? (0.10 + Math.pow(rpmNorm, 0.68) * 0.18) : (0.18 + rpmNorm * 0.34);
  const intakeResonance = cleanProfile
    ? (
      Math.sin(state.intakeResonancePhase + idleLope * 2.5) * 0.62 +
      Math.sin(state.intakeResonancePhase * 1.48 + 0.7) * 0.24
    ) * state.analysis.intakeGain * Math.pow(throttle, 1.25) * (0.020 + rpmNorm * (cleanHandoffProfile ? 0.0015 : staticCleanProfile ? 0.004 : airwashControlProfile ? 0.010 : accessoryQualityProfile ? 0.024 : 0.042)) * intakeCharacterLift * clamp(intakeTexture * clarity / Math.max(0.82, muffling), 0.45, 1.65) * inductionWorkGate
    : 0;
  const intake = cleanProfile
    ? (intakeTextureNoise * (staticCleanProfile ? 0 : airwashControlProfile ? 0.010 : accessoryQualityProfile ? 0.040 : 0.18) + intakePulse * (cleanHandoffProfile ? 0.045 : staticCleanProfile ? 0.085 : airwashControlProfile ? 0.10 : accessoryQualityProfile ? 0.13 : 0.11)) *
      state.analysis.intakeGain *
      Math.pow(throttle, 1.65) *
      intakeRpmGain *
      clamp(intakeTexture * clarity / Math.max(0.82, muffling), 0.45, 1.65) *
      (cylinderBalanceProfile ? 1.08 : 1) *
      inductionWorkGate +
      intakeResonance
    : (state.intakeNoise * 0.7 + intakePulse * 0.08) * state.analysis.intakeGain * Math.pow(throttle, 1.45) * (0.16 + rpmNorm * 0.25);
  const valveCarrier = Math.sin(state.mechPhase);
  const mechTick = Math.pow(Math.max(0, valveCarrier), 18) * (0.0015 + rpmNorm * 0.0045);
  let valvetrain = 0;
  if (cleanProfile) {
    if (clarityProfile) {
      state.mechanicalNoise = state.mechanicalNoise * (staticCleanProfile ? 0.86 : 0.42) + (nextRandom(state) - 0.5) * (staticCleanProfile ? 0 : 0.58);
      state.mechanicalNoiseLow = state.mechanicalNoiseLow * 0.88 + state.mechanicalNoise * 0.12;
      const mechanicalTexture = staticCleanProfile ? 0 : state.mechanicalNoise - state.mechanicalNoiseLow * 0.68;
      const mechanicalEnvelope = clamp(state.mechanicalTickEnvelope * edgeConditionedSupport, 0, 1.55);
      const subduedValveTone = valveCarrier * (0.00028 + rpmNorm * 0.00076) * clamp(0.92 - state.combustionEnvelope * 0.16, 0.64, 0.92);
      const eventClick = mechTick * mechanicalEnvelope * (staticCleanProfile ? 0.52 : 0.42);
      const dryTick = mechanicalTexture * mechanicalEnvelope * (0.0038 + rpmNorm * 0.0074) * (0.72 + load * 0.32);
      valvetrain = subduedValveTone + eventClick + dryTick;
    } else {
      valvetrain = valveCarrier * (0.0014 + rpmNorm * 0.0026) + mechTick;
    }
  } else {
    valvetrain = valveCarrier * (0.002 + rpmNorm * 0.004) + (nextRandom(state) - 0.5) * (0.007 + rpmNorm * 0.010);
  }
  const flatPlaneHighOrder = quick.crankshaft === "flat-plane" ? 1.35 : 0.85;
  const highOrderRpm = cleanProfile ? Math.pow(rpmNorm, 1.4) : 1;
  const orderDrive = Math.pow(throttle, 1.25) * (0.28 + load * 0.72);
  let orderTone = 0;
  if (cleanProfile) {
    const tiltDarkening = clamp(1.08 - (spectralTilt * acoustic.spectralTilt - 1) * 0.22, 0.62, 1.24);
    for (const bin of acoustic.orderSpectrum) {
      const frequency = cycleHz * bin.cycleOrder;
      if (frequency < 32 || frequency > 2600) continue;
      const lowBias = bin.cycleOrder <= 6 ? lowOrderDrive : 1;
      const highBias = bin.cycleOrder >= state.analysis.cylinderCount
        ? flatPlaneHighOrder * highOrderRpm * acoustic.familyPreset.highOrderGain * tiltDarkening
        : 1;
      const bandGain = bin.cycleOrder <= 8
        ? bin.bankDifference * 0.0068 + bin.wholeEngineGain * 0.0042
        : bin.bankDifference * 0.0032 + bin.wholeEngineGain * 0.0038;
      orderTone += Math.sin(state.rumblePhase * bin.cycleOrder + bin.phaseRad) * bandGain * lowBias * highBias;
    }
    orderTone *= orderDrive * clamp(orderWeight * clarity, 0.40, 1.65) * (clarityProfile ? clamp(0.48 + state.combustionEnvelope * 0.20, 0.42, 0.78) : 1);
  }

  const clarityIntakeTrim = clarityProfile ? cleanHandoffProfile ? clamp(0.36 + intakePulse * 0.08 + throttle * 0.04, 0.34, 0.48) : clamp(0.70 + intakePulse * 0.18 + throttle * 0.08, 0.68, 0.94) : 1;
  const clarityValvetrainTrim = clarityProfile ? clamp(0.74 + edgeConditionedSupport * 0.18, 0.72, 0.95) : 1;
  left += rumble * inductionBodyMakeup + densityBed * 0.94 + intake * (accessoryQualityProfile ? 0.74 : 0.82) * clarityIntakeTrim + valvetrain * clarityValvetrainTrim + orderTone * 0.96;
  right += rumble * inductionBodyMakeup + densityBed * 1.06 + intake * (accessoryQualityProfile ? 0.92 : 1.05) * clarityIntakeTrim + valvetrain * 0.9 * clarityValvetrainTrim + orderTone * 1.04;

  if (forcedInduction.type === "turbo") {
    const threshold = forcedInduction.turboSpoolThreshold ?? 2000;
    const sizeLag = forcedInduction.turboSize === "small" ? 0.7 : forcedInduction.turboSize === "large" ? 1.35 : 1;
    const spoolRange = (accessoryQualityProfile ? 1700 : 2600) * sizeLag;
    const aboveThreshold = Math.max(0, rpm - threshold);
    const earlySpoolLift = accessoryQualityProfile && aboveThreshold > 0
      ? Math.min(0.28, 0.12 + aboveThreshold / 10000)
      : 0;
    const targetSpool = clamp((aboveThreshold / spoolRange) * throttle * (accessoryQualityProfile ? 0.88 + load * 0.40 : 0.76 + load * 0.34) + earlySpoolLift * throttle, 0, 1);
    if (accessoryQualityProfile) {
      const spoolResponseSec = forcedInduction.turboSize === "small" ? 0.070 : forcedInduction.turboSize === "large" ? 0.240 : 0.135;
      state.turboSpool += (targetSpool - state.turboSpool) * (1 - Math.exp(-1 / (sr * spoolResponseSec)));
    } else {
      state.turboSpool = targetSpool;
    }
    const spool = clamp(accessoryQualityProfile ? state.turboSpool : targetSpool, 0, 1);
    const shaftTone = accessoryQualityProfile ? Math.pow(spool, 0.58) * (0.82 + rpmNorm * 0.18) : spool;
    const turboHz = accessoryQualityProfile
      ? clamp(2200 + shaftTone * (forcedInduction.turboSize === "large" ? 4400 : forcedInduction.turboSize === "small" ? 6100 : 5200) + rpmNorm * 320, 1900, 9800)
      : cleanProfile ? 1800 + spool * 5400 + rpmNorm * 700 : 1700 + spool * 6500 + rpmNorm * 900;
    state.boostPhase += TWO_PI * turboHz / sr;
    if (state.boostPhase > TWO_PI) state.boostPhase -= TWO_PI;
    const whistle = accessoryQualityProfile
      ? Math.sin(state.boostPhase) * 0.50 + Math.sin(state.boostPhase * 1.618 + state.turboFlutterPhase * 0.2) * 0.14
      : Math.sin(state.boostPhase) + Math.sin(state.boostPhase * 1.49) * (cleanProfile ? 0.12 : 0.28);
    if (cleanProfile) {
      state.turboFlutterPhase += TWO_PI * (accessoryQualityProfile ? 28 + spool * 92 + rpmNorm * 26 : 34 + spool * 130 + rpmNorm * 80) / sr;
      if (state.turboFlutterPhase > TWO_PI) state.turboFlutterPhase -= TWO_PI;
      const gatedFlow = spool * throttle * clamp(turboWhoosh, 0.45, 1.75);
      state.turboWhooshFast = state.turboWhooshFast * (cleanHandoffProfile ? 0.94 : accessoryQualityProfile ? 0.64 : 0.72) + (nextRandom(state) - 0.5) * (cleanHandoffProfile ? 0 : accessoryQualityProfile ? 0.36 : 0.28);
      state.turboWhooshSlow = state.turboWhooshSlow * (cleanHandoffProfile ? 0.992 : accessoryQualityProfile ? 0.975 : 0.985) + state.turboWhooshFast * (cleanHandoffProfile ? 0.008 : accessoryQualityProfile ? 0.025 : 0.015);
      const compressorTexture = cleanHandoffProfile ? 0 : state.turboWhooshFast - state.turboWhooshSlow * (accessoryQualityProfile ? 0.62 : 0.55);
      const surgeWindow = accessoryQualityProfile ? clamp((1 - Math.abs(spool - 0.58) * 1.25) * (0.34 + load * 0.66) * throttle, 0, 1) : 0;
      const compressorBreath = Math.sin(state.turboFlutterPhase) * gatedFlow * (cleanHandoffProfile ? 0.0008 + surgeWindow * 0.0022 + rpmNorm * 0.0007 : accessoryQualityProfile ? 0.0025 + surgeWindow * 0.006 + rpmNorm * 0.0018 : 0.002 + rpmNorm * 0.004);
      const flowNoise = compressorTexture *
        gatedFlow *
        (cleanHandoffProfile ? 0 : accessoryQualityProfile ? 0.010 + surgeWindow * 0.012 + (forcedInduction.maxBoost ?? 15) / 3600 : 0.010 + (forcedInduction.maxBoost ?? 15) / 3200);
      const wastegate = forcedInduction.wastegateEnabled && load > 0.55 && spool > 0.65
        ? (accessoryQualityProfile ? Math.sin(state.turboFlutterPhase * 1.7) + compressorTexture * (cleanHandoffProfile ? 0 : 0.45) : Math.sin(state.boostPhase * 0.37)) * spool * (cleanHandoffProfile ? 0.0016 : accessoryQualityProfile ? 0.0045 : 0.006) * clamp(turboWhoosh, 0.5, 1.5)
        : 0;
      const turbo = whistle * spool * throttle * (accessoryQualityProfile ? 0.004 + (forcedInduction.maxBoost ?? 15) / 5200 : 0.005 + (forcedInduction.maxBoost ?? 15) / 3000) * clamp(turboTone, 0.45, 1.45) +
        flowNoise +
        compressorBreath +
        wastegate;
      left += turbo * (accessoryQualityProfile ? 0.94 : 0.88);
      right += turbo;
    } else {
      const turbo = whistle * spool * (0.018 + (forcedInduction.maxBoost ?? 15) / 900);
      left += turbo * 0.86;
      right += turbo;
    }
  } else if (forcedInduction.type === "supercharged") {
    const type = forcedInduction.superchargerType ?? "roots";
    const driveRatio = type === "centrifugal" ? 5.1 : type === "twin-screw" ? 3.45 : 2.85;
    const rotorHz = (rpm / 60) * driveRatio;
    const superchargerWake = accessoryQualityProfile ? clamp((rpm - 900) / 850, 0, 1) : 1;
    const scHz = accessoryQualityProfile
      ? clamp(rotorHz * (type === "centrifugal" ? 12.5 : type === "twin-screw" ? 9.5 : 7.5), 260, 6800)
      : (rpm / 60) * driveRatio * (cleanProfile ? (type === "roots" ? 9 : 11) : 12);
    state.boostPhase += TWO_PI * scHz / sr;
    state.superchargerGearPhase += TWO_PI * clamp(rotorHz * (type === "twin-screw" ? 10.5 : type === "roots" ? 8.2 : 13.5), 220, 7600) / sr;
    state.superchargerLobePhase += TWO_PI * clamp(rotorHz * (type === "roots" ? 6 : type === "twin-screw" ? 8 : 11), 90, 5200) / sr;
    if (state.boostPhase > TWO_PI) state.boostPhase -= TWO_PI;
    if (state.superchargerGearPhase > TWO_PI) state.superchargerGearPhase -= TWO_PI;
    if (state.superchargerLobePhase > TWO_PI) state.superchargerLobePhase -= TWO_PI;
    if (cleanProfile) {
      const typeGain = type === "roots" ? 1.07 : type === "twin-screw" ? 1.55 : 0.92;
      const bypassGate = accessoryQualityProfile ? clamp(0.32 + throttle * 0.50 + load * 0.28, 0.32, 1.08) : 1;
      const whine = accessoryQualityProfile
        ? Math.sin(state.superchargerGearPhase) * 0.62 +
          Math.sin(state.superchargerGearPhase * 2.01 + 0.3) * 0.18 +
          Math.sin(state.boostPhase * 0.74 + 0.8) * 0.16
        : Math.sin(state.boostPhase) + Math.sin(state.boostPhase * 2) * 0.10;
      state.superchargerNoise = accessoryQualityProfile
        ? state.superchargerNoise * (cleanHandoffProfile ? 0.98 : 0.90) + (nextRandom(state) - 0.5) * (cleanHandoffProfile ? 0 : 0.10)
        : state.superchargerNoise;
      const lobePulse = type === "centrifugal"
        ? 0
        : Math.pow(Math.max(0, Math.sin(state.superchargerLobePhase)), type === "roots" ? 2.4 : 2.4) * (accessoryQualityProfile ? (type === "twin-screw" ? 0.024 + load * 0.036 : 0.010 + load * 0.018) : 0.006 + load * 0.010);
      const compressorAir = accessoryQualityProfile
        ? state.superchargerNoise * (cleanHandoffProfile ? 0 : type === "centrifugal" ? 0.014 : type === "twin-screw" ? 0.018 : 0.007) * bypassGate * (0.45 + rpmNorm * 0.55)
        : 0;
      const centrifugalSiren = accessoryQualityProfile && type === "centrifugal"
        ? (Math.sin(state.boostPhase) * 0.54 + Math.sin(state.boostPhase * 1.37) * 0.16) * Math.pow(rpmNorm, 1.35) * (0.010 + load * 0.014)
        : 0;
      const twinScrewCompression = accessoryQualityProfile && type === "twin-screw"
        ? Math.tanh(whine * 1.9 + state.superchargerNoise * (cleanHandoffProfile ? 0 : 1.1)) * (cleanHandoffProfile ? 0.020 + load * 0.018 : 0.030 + load * 0.030) * bypassGate
        : 0;
      const superchargerOutputLift = accessoryQualityProfile && type === "twin-screw" ? 1.16 : 1;
      const gain = (forcedInduction.whineIntensity ?? 0.6) *
        typeGain *
        (accessoryQualityProfile ? 0.034 + Math.pow(Math.max(0, rpmNorm), 0.72) * 0.072 : 0.008 + rpmNorm * 0.038) *
        clamp(superchargerWhine, 0.45, 1.75) *
        bypassGate;
      const supercharger = (whine * gain +
        lobePulse * (forcedInduction.whineIntensity ?? 0.6) * clamp(superchargerWhine, 0.55, 1.55) +
        compressorAir +
        twinScrewCompression * (forcedInduction.whineIntensity ?? 0.6) * clamp(superchargerWhine, 0.55, 1.55) +
        centrifugalSiren * (forcedInduction.whineIntensity ?? 0.6) * clamp(superchargerWhine, 0.55, 1.55)) * superchargerOutputLift * superchargerWake;
      left += supercharger * (accessoryQualityProfile ? 0.96 : 0.92);
      right += supercharger;
    } else {
      const whine = Math.sin(state.boostPhase) + Math.sin(state.boostPhase * 2) * 0.22;
      const gain = (forcedInduction.whineIntensity ?? 0.6) * (0.012 + rpmNorm * 0.055);
      left += whine * gain * 0.92;
      right += whine * gain;
    }
  }

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    left = 0;
    right = 0;
    state.previousLeftInput = 0;
    state.previousRightInput = 0;
    state.previousLeftOutput = 0;
    state.previousRightOutput = 0;
  }

  const dcCoefficient = dcBlockCoefficientForSoundProfile(soundProfile);
  let dcLeft = left - state.previousLeftInput + dcCoefficient * state.previousLeftOutput;
  let dcRight = right - state.previousRightInput + dcCoefficient * state.previousRightOutput;
  if (!Number.isFinite(dcLeft) || !Number.isFinite(dcRight)) {
    dcLeft = 0;
    dcRight = 0;
    state.previousLeftInput = 0;
    state.previousRightInput = 0;
    state.previousLeftOutput = 0;
    state.previousRightOutput = 0;
  } else {
    state.previousLeftInput = left;
    state.previousRightInput = right;
    state.previousLeftOutput = clamp(dcLeft, -1.8, 1.8);
    state.previousRightOutput = clamp(dcRight, -1.8, 1.8);
  }

  if (stereoStabilityProfile && state.analysis.cylinderCount >= 10) {
    const denseOutputWidth = clamp(0.50 - Math.max(0, state.analysis.cylinderCount - 8) * 0.055 - Math.max(0, rpmNorm - 0.65) * 0.22, 0.18, 0.50);
    const mid = (dcLeft + dcRight) * 0.5;
    const side = (dcLeft - dcRight) * 0.5 * denseOutputWidth;
    dcLeft = mid + side;
    dcRight = mid - side;
  }

  const cylinderOutputMakeup = cylinderBalanceProfile
    ? clamp(1 + Math.max(0, state.analysis.cylinderCount - 8) * (cleanHandoffProfile ? 0.240 : 0.180) + Math.max(0, acoustic.pulseDensitySmoothing - 1) * (cleanHandoffProfile ? 0.160 : 0.120), 1, cleanHandoffProfile ? 1.84 : 1.68)
    : 1;
  const tuningOutputGain = cleanProfile ? clamp(1 + (clarity - muffling) * (clarityProfile ? 0.11 : 0.08), 0.84, 1.14) : 1;
  const outputDrive = clarityProfile ? (cylinderBalanceProfile ? 1.04 : 1.02) : 1.18;
  const outputGain = (clarityProfile ? 0.96 : 0.88) * cylinderOutputMakeup;
  if (clarityProfile) {
    const drivenLeft = dcLeft * outputDrive * tuningOutputGain;
    const drivenRight = dcRight * outputDrive * tuningOutputGain;
    const clearLeft = shapeClarityOutput(drivenLeft);
    const clearRight = shapeClarityOutput(drivenRight);
    return [clamp(clearLeft * outputGain, -1, 1), clamp(clearRight * outputGain, -1, 1)];
  }

  return [Math.tanh(dcLeft * outputDrive * tuningOutputGain) * outputGain, Math.tanh(dcRight * outputDrive * tuningOutputGain) * outputGain];
}

export function generateEnginePcm(config: EngineConfiguration, options: EngineRenderOptions): { left: Float32Array; right: Float32Array; sampleRate: number } {
  const sampleRate = options.sampleRate ?? 44100;
  const length = Math.max(1, Math.floor(sampleRate * options.durationSec));
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const state = createState(config, sampleRate);
  const profile = options.profile ?? "sweep";
  const startRpm = options.startRpm ?? 850;
  const endRpm = options.endRpm ?? config.quick.redline;
  const load = options.load ?? 0.55;

  for (let i = 0; i < length; i++) {
    const progress = i / Math.max(1, length - 1);
    const rpm = rpmAtSample(progress, config, { startRpm, endRpm, profile });
    const throttle = options.throttle ?? (profile === "steady" ? 0.35 : clamp((rpm - startRpm) / Math.max(1, endRpm - startRpm), 0.08, 1));
    const sample = synthesizeSample(state, config, rpm, throttle, load);
    left[i] = sample[0];
    right[i] = sample[1];
  }

  if (options.normalize) normalizePcm(left, right);
  return { left, right, sampleRate };
}

export function normalizePcm(left: Float32Array, right: Float32Array, target = 0.95) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 0 && peak < target) {
    const gain = target / peak;
    for (let i = 0; i < left.length; i++) {
      left[i] *= gain;
      right[i] *= gain;
    }
  }
}
