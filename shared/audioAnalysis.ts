import type { EngineConfiguration, SoundTuningWeights } from "./engineTypes";
import { DEFAULT_SOUND_TUNING_WEIGHTS } from "./engineTypes";
import type { CapturePerspective, CaptureSegmentType } from "./referenceCapture";

export type AudioAnalysisEngine = "meyda" | "essentia" | "fallback";

export interface AudioFeatureFrame {
  timeSec: number;
  rms: number;
  peakAmplitude: number;
  zeroCrossingRate: number;
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlatness: number;
  dominantFrequency: number;
  transientScore: number;
  mfcc: number[];
  amplitudeSpectrum: number[];
}

export interface SpectralEnvelopeBand {
  hzLow: number;
  hzHigh: number;
  energy: number;
}

export interface ResonancePeak {
  frequencyHz: number;
  energy: number;
  bandwidthHz: number;
}

export interface OrderEnergyPoint {
  cycleOrder: number;
  engineOrder: number;
  frequencyHz: number;
  energy: number;
}

export interface BassEnvelopeStats {
  mean: number;
  peak: number;
  modulationDepth: number;
  pulseDensity: number;
}

export interface CaptureAnalysisSummary {
  durationSec: number;
  sampleRate: number;
  frameCount: number;
  rmsMean: number;
  rmsPeak: number;
  crestFactor: number;
  zeroCrossingRateMean: number;
  spectralCentroidMean: number;
  spectralCentroidPeak: number;
  spectralRolloffMean: number;
  spectralFlatnessMean: number;
  dominantFrequencyMean: number;
  transientDensity: number;
  harmonicRatio: number;
  lowBandEnergy: number;
  spectralTilt: number;
  resonancePeaks: ResonancePeak[];
  orderEnergyCurve: OrderEnergyPoint[];
  bankRoughness: number;
  bassEnvelope: BassEnvelopeStats;
  mfccMean: number[];
  spectralEnvelope: SpectralEnvelopeBand[];
  engines: AudioAnalysisEngine[];
  notes: string[];
}

export interface CaptureAnalysisMetadata {
  captureId: string;
  segmentType: CaptureSegmentType;
  perspective: CapturePerspective;
  rpmStart: number;
  rpmEnd: number;
  load: number;
  throttle: number;
  engineConfig?: EngineConfiguration;
  engineFamilyKey?: string;
}

export interface CaptureAnalysis {
  id: string;
  captureId: string;
  createdAt: string;
  engineFamilyKey: string;
  segmentType: CaptureSegmentType;
  perspective: CapturePerspective;
  rpmStart: number;
  rpmEnd: number;
  load: number;
  throttle: number;
  sampleRate: number;
  frameSize: number;
  hopSize: number;
  engines: AudioAnalysisEngine[];
  summary: CaptureAnalysisSummary;
  frames: AudioFeatureFrame[];
}

export interface TuningTarget {
  id: string;
  captureId: string;
  analysisId: string;
  engineFamilyKey: string;
  createdAt: string;
  segmentType: CaptureSegmentType;
  perspective: CapturePerspective;
  rpmStart: number;
  rpmEnd: number;
  load: number;
  throttle: number;
  summary: CaptureAnalysisSummary;
  weights: SoundTuningWeights;
}

export interface TuningTargetLookupCriteria {
  config?: EngineConfiguration;
  engineFamilyKey?: string;
  rpm?: number;
  load?: number;
  perspective?: CapturePerspective;
  segmentType?: CaptureSegmentType;
}

export interface AudioAnalysisOptions {
  frameSize?: number;
  hopSize?: number;
  maxFrames?: number;
  engines?: AudioAnalysisEngine[];
}

const DEFAULT_FRAME_SIZE = 2048;
const DEFAULT_HOP_SIZE = 1024;
const DEFAULT_MAX_FRAMES = 220;
const MFCC_COUNT = 13;
const SPECTRAL_BAND_COUNT = 16;
const STORED_SPECTRUM_BINS = 64;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function peak(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((max, value) => Math.max(max, value), 0);
}

function normalizeLabel(value: string | undefined, fallback = "default"): string {
  return (value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function getEngineFamilyKey(config: EngineConfiguration): string {
  const intakeType = config.advanced?.intakeType ?? "single-throttle-body";
  const forced = config.forcedInduction.type === "turbo"
    ? `turbo-${config.forcedInduction.turboSize ?? "balanced"}`
    : config.forcedInduction.type === "supercharged"
      ? `supercharged-${config.forcedInduction.superchargerType ?? "roots"}`
      : "na";

  return [
    normalizeLabel(config.quick.layout),
    `${Math.max(1, Math.floor(config.quick.cylinderCount))}cyl`,
    normalizeLabel(config.quick.crankshaft),
    normalizeLabel(config.quick.exhaustCharacter),
    normalizeLabel(intakeType),
    normalizeLabel(forced),
  ].join(":");
}

export function createAnalysisId(captureId: string, createdAt = new Date()): string {
  return `analysis-${createdAt.getTime()}-${captureId}`.replace(/[^a-zA-Z0-9-]+/g, "-").slice(0, 120);
}

function downsampleSpectrum(spectrum: number[], targetBins = STORED_SPECTRUM_BINS): number[] {
  if (spectrum.length === 0) return Array(targetBins).fill(0);
  const peakMagnitude = Math.max(...spectrum, 1e-12);
  return Array.from({ length: targetBins }, (_, index) => {
    const start = Math.floor((index / targetBins) * spectrum.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / targetBins) * spectrum.length));
    let sum = 0;
    for (let i = start; i < end; i++) sum += spectrum[i] ?? 0;
    return clamp(sum / (end - start) / peakMagnitude, 0, 1);
  });
}

function spectrumEnergyInRange(spectrum: number[], sampleRate: number, hzLow: number, hzHigh: number): number {
  if (spectrum.length === 0) return 0;
  const nyquist = sampleRate / 2;
  const start = clamp(Math.floor((hzLow / nyquist) * spectrum.length), 0, spectrum.length - 1);
  const end = clamp(Math.ceil((hzHigh / nyquist) * spectrum.length), start + 1, spectrum.length);
  let energy = 0;
  for (let i = start; i < end; i++) energy += spectrum[i] ?? 0;
  return clamp(energy / Math.max(1, end - start), 0, 1);
}

function spectrumEnergyNear(spectrum: number[], sampleRate: number, frequencyHz: number): number {
  if (frequencyHz <= 0 || frequencyHz >= sampleRate / 2) return 0;
  const bandwidth = Math.max(18, frequencyHz * 0.08);
  return spectrumEnergyInRange(spectrum, sampleRate, frequencyHz - bandwidth, frequencyHz + bandwidth);
}

function findResonancePeaks(spectrum: number[], sampleRate: number): ResonancePeak[] {
  if (spectrum.length < 3) return [];
  const nyquist = sampleRate / 2;
  const minBin = Math.max(1, Math.floor((35 / nyquist) * spectrum.length));
  const maxBin = Math.min(spectrum.length - 2, Math.ceil((900 / nyquist) * spectrum.length));
  const peaks: ResonancePeak[] = [];

  for (let bin = minBin; bin <= maxBin; bin++) {
    const value = spectrum[bin] ?? 0;
    if (value <= (spectrum[bin - 1] ?? 0) || value < (spectrum[bin + 1] ?? 0)) continue;
    peaks.push({
      frequencyHz: Math.round((bin / spectrum.length) * nyquist),
      energy: clamp(value, 0, 1),
      bandwidthHz: Math.round(nyquist / spectrum.length),
    });
  }

  return peaks
    .sort((a, b) => b.energy - a.energy)
    .slice(0, 6)
    .sort((a, b) => a.frequencyHz - b.frequencyHz);
}

function buildOrderEnergyCurve(
  spectrum: number[],
  sampleRate: number,
  rpmStart?: number,
  rpmEnd?: number,
): OrderEnergyPoint[] {
  const averageRpm = ((rpmStart ?? 0) + (rpmEnd ?? 0)) / 2;
  if (averageRpm <= 0) return [];
  const cycleHz = averageRpm / 120;

  return Array.from({ length: 24 }, (_, index) => {
    const cycleOrder = index + 1;
    const frequencyHz = cycleHz * cycleOrder;
    return {
      cycleOrder,
      engineOrder: cycleOrder / 2,
      frequencyHz: Math.round(frequencyHz),
      energy: spectrumEnergyNear(spectrum, sampleRate, frequencyHz),
    };
  });
}

function calculateBassEnvelope(frames: AudioFeatureFrame[], sampleRate: number): BassEnvelopeStats {
  const lowEnergies = frames.map((frame) => spectrumEnergyInRange(frame.amplitudeSpectrum, sampleRate, 35, 180));
  const bassMean = mean(lowEnergies);
  const bassPeak = peak(lowEnergies);
  const bassMin = lowEnergies.length ? lowEnergies.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY) : 0;
  const activeFrames = lowEnergies.filter((value) => value > bassMean * 1.18).length;

  return {
    mean: bassMean,
    peak: bassPeak,
    modulationDepth: bassPeak > 0 ? clamp((bassPeak - bassMin) / bassPeak, 0, 1) : 0,
    pulseDensity: lowEnergies.length ? activeFrames / lowEnergies.length : 0,
  };
}

function buildMfccLikeBands(spectrum: number[]): number[] {
  if (spectrum.length === 0) return Array(MFCC_COUNT).fill(0);
  return Array.from({ length: MFCC_COUNT }, (_, band) => {
    const start = Math.floor(Math.pow(band / MFCC_COUNT, 1.7) * spectrum.length);
    const end = Math.max(start + 1, Math.floor(Math.pow((band + 1) / MFCC_COUNT, 1.7) * spectrum.length));
    let sum = 0;
    for (let i = start; i < end; i++) sum += spectrum[i] ?? 0;
    return Math.log10(1e-7 + sum / (end - start));
  });
}

function hanning(index: number, length: number): number {
  if (length <= 1) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * 2 * index) / (length - 1));
}

function calculateSpectrum(frame: Float32Array, sampleRate: number): {
  magnitudes: number[];
  centroid: number;
  rolloff: number;
  flatness: number;
  dominantFrequency: number;
} {
  const bins = Math.max(8, Math.min(512, Math.floor(frame.length / 2)));
  const magnitudes = new Array<number>(bins);
  let totalMagnitude = 0;
  let weightedFrequency = 0;
  let dominantMagnitude = 0;
  let dominantFrequency = 0;

  for (let bin = 1; bin <= bins; bin++) {
    let real = 0;
    let imaginary = 0;
    const angleStep = (Math.PI * 2 * bin) / frame.length;
    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i] * hanning(i, frame.length);
      const angle = angleStep * i;
      real += sample * Math.cos(angle);
      imaginary -= sample * Math.sin(angle);
    }

    const magnitude = Math.sqrt(real * real + imaginary * imaginary) / frame.length;
    const frequency = (bin * sampleRate) / frame.length;
    magnitudes[bin - 1] = magnitude;
    totalMagnitude += magnitude;
    weightedFrequency += frequency * magnitude;

    if (magnitude > dominantMagnitude) {
      dominantMagnitude = magnitude;
      dominantFrequency = frequency;
    }
  }

  const centroid = totalMagnitude > 0 ? weightedFrequency / totalMagnitude : 0;
  const rolloffTarget = totalMagnitude * 0.85;
  let cumulative = 0;
  let rolloff = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    cumulative += magnitudes[i];
    if (cumulative >= rolloffTarget) {
      rolloff = ((i + 1) * sampleRate) / frame.length;
      break;
    }
  }

  const arithmeticMean = totalMagnitude / magnitudes.length || 0;
  const geometricMean = Math.exp(mean(magnitudes.map((value) => Math.log(Math.max(value, 1e-12)))));
  const flatness = arithmeticMean > 0 ? clamp(geometricMean / arithmeticMean, 0, 1) : 0;

  return { magnitudes, centroid, rolloff, flatness, dominantFrequency };
}

export function calculateFrameFeatures(frame: Float32Array, sampleRate: number, timeSec = 0): AudioFeatureFrame {
  let sumSquares = 0;
  let peakAmplitude = 0;
  let crossings = 0;

  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i];
    sumSquares += sample * sample;
    peakAmplitude = Math.max(peakAmplitude, Math.abs(sample));
    if (i > 0 && ((frame[i - 1] < 0 && sample >= 0) || (frame[i - 1] >= 0 && sample < 0))) {
      crossings++;
    }
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, frame.length));
  const crest = rms > 0 ? peakAmplitude / rms : 0;
  const spectrum = calculateSpectrum(frame, sampleRate);

  return {
    timeSec,
    rms,
    peakAmplitude,
    zeroCrossingRate: crossings / Math.max(1, frame.length - 1),
    spectralCentroid: spectrum.centroid,
    spectralRolloff: spectrum.rolloff,
    spectralFlatness: spectrum.flatness,
    dominantFrequency: spectrum.dominantFrequency,
    transientScore: clamp((crest - 1.7) / 5.5, 0, 1),
    mfcc: buildMfccLikeBands(spectrum.magnitudes),
    amplitudeSpectrum: downsampleSpectrum(spectrum.magnitudes),
  };
}

export function summarizeFeatureFrames(
  frames: AudioFeatureFrame[],
  sampleRate: number,
  durationSec: number,
  engines: AudioAnalysisEngine[] = ["fallback"],
  notes: string[] = [],
  orderContext: { rpmStart?: number; rpmEnd?: number } = {},
): CaptureAnalysisSummary {
  const rmsValues = frames.map((frame) => frame.rms);
  const spectralCentroids = frames.map((frame) => frame.spectralCentroid);
  const flatnessValues = frames.map((frame) => frame.spectralFlatness);
  const rolloffValues = frames.map((frame) => frame.spectralRolloff);
  const dominantValues = frames.map((frame) => frame.dominantFrequency).filter((value) => value > 0);
  const rmsMean = mean(rmsValues);
  const rmsPeak = peak(rmsValues);
  const peakAmplitude = peak(frames.map((frame) => frame.peakAmplitude));
  const crestFactor = rmsMean > 0 ? peakAmplitude / rmsMean : 0;
  const transientDensity = mean(frames.map((frame) => frame.transientScore));
  const harmonicRatio = clamp((1 - mean(flatnessValues)) * 0.72 + clamp(mean(dominantValues) / 2600, 0, 1) * 0.18, 0, 1);
  const mfccMean = Array.from({ length: MFCC_COUNT }, (_, index) => mean(frames.map((frame) => frame.mfcc[index] ?? 0)));
  const spectrumBins = frames[0]?.amplitudeSpectrum.length ?? STORED_SPECTRUM_BINS;
  const averagedSpectrum = Array.from({ length: spectrumBins }, (_, index) => mean(frames.map((frame) => frame.amplitudeSpectrum[index] ?? 0)));
  const lowBandEnergy = spectrumEnergyInRange(averagedSpectrum, sampleRate, 35, 180);
  const lowMidEnergy = spectrumEnergyInRange(averagedSpectrum, sampleRate, 80, 520);
  const presenceEnergy = spectrumEnergyInRange(averagedSpectrum, sampleRate, 1100, 5200);
  const spectralTilt = clamp(Math.log2((lowMidEnergy + 0.02) / (presenceEnergy + 0.02)), -1.5, 1.5);
  const bassEnvelope = calculateBassEnvelope(frames, sampleRate);
  const resonancePeaks = findResonancePeaks(averagedSpectrum, sampleRate);
  const orderEnergyCurve = buildOrderEnergyCurve(averagedSpectrum, sampleRate, orderContext.rpmStart, orderContext.rpmEnd);
  const bankRoughness = clamp(bassEnvelope.modulationDepth * 0.46 + transientDensity * 0.22 + lowBandEnergy * 0.32, 0, 1);
  const spectralEnvelope = Array.from({ length: SPECTRAL_BAND_COUNT }, (_, band) => {
    const start = Math.floor((band / SPECTRAL_BAND_COUNT) * averagedSpectrum.length);
    const end = Math.max(start + 1, Math.floor(((band + 1) / SPECTRAL_BAND_COUNT) * averagedSpectrum.length));
    let energy = 0;
    for (let i = start; i < end; i++) energy += averagedSpectrum[i] ?? 0;
    return {
      hzLow: Math.round((band / SPECTRAL_BAND_COUNT) * (sampleRate / 2)),
      hzHigh: Math.round(((band + 1) / SPECTRAL_BAND_COUNT) * (sampleRate / 2)),
      energy: clamp(energy / (end - start), 0, 1),
    };
  });

  return {
    durationSec,
    sampleRate,
    frameCount: frames.length,
    rmsMean,
    rmsPeak,
    crestFactor,
    zeroCrossingRateMean: mean(frames.map((frame) => frame.zeroCrossingRate)),
    spectralCentroidMean: mean(spectralCentroids),
    spectralCentroidPeak: peak(spectralCentroids),
    spectralRolloffMean: mean(rolloffValues),
    spectralFlatnessMean: mean(flatnessValues),
    dominantFrequencyMean: mean(dominantValues),
    transientDensity,
    harmonicRatio,
    lowBandEnergy,
    spectralTilt,
    resonancePeaks,
    orderEnergyCurve,
    bankRoughness,
    bassEnvelope,
    mfccMean,
    spectralEnvelope,
    engines: Array.from(new Set(engines)),
    notes,
  };
}

export function analyzePcmReference(
  samples: Float32Array,
  sampleRate: number,
  metadata: CaptureAnalysisMetadata,
  options: AudioAnalysisOptions = {},
): CaptureAnalysis {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const totalFrames = Math.max(1, Math.floor(Math.max(0, samples.length - frameSize) / hopSize) + 1);
  const frameStride = Math.max(1, Math.ceil(totalFrames / maxFrames));
  const frames: AudioFeatureFrame[] = [];

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += frameStride) {
    const start = frameIndex * hopSize;
    const frame = new Float32Array(frameSize);
    frame.set(samples.subarray(start, Math.min(samples.length, start + frameSize)));
    frames.push(calculateFrameFeatures(frame, sampleRate, start / sampleRate));
  }

  const engines: AudioAnalysisEngine[] = options.engines?.length ? options.engines : ["fallback"];
  const summary = summarizeFeatureFrames(frames, sampleRate, samples.length / sampleRate, engines, [], {
    rpmStart: metadata.rpmStart,
    rpmEnd: metadata.rpmEnd,
  });
  const createdAt = new Date();
  const id = createAnalysisId(metadata.captureId, createdAt);

  return {
    id,
    captureId: metadata.captureId,
    createdAt: createdAt.toISOString(),
    engineFamilyKey: metadata.engineFamilyKey ?? (metadata.engineConfig ? getEngineFamilyKey(metadata.engineConfig) : "unknown"),
    segmentType: metadata.segmentType,
    perspective: metadata.perspective,
    rpmStart: metadata.rpmStart,
    rpmEnd: metadata.rpmEnd,
    load: metadata.load,
    throttle: metadata.throttle,
    sampleRate,
    frameSize,
    hopSize,
    engines,
    summary,
    frames,
  };
}

function weight(value: number, fallback = 1): number {
  return Number.isFinite(value) ? clamp(value, 0.35, 1.85) : fallback;
}

export function deriveTuningWeightsFromSummary(summary: CaptureAnalysisSummary, engineFamilyKey: string): SoundTuningWeights {
  const centroidNorm = clamp(summary.spectralCentroidMean / 3200, 0, 1.8);
  const rolloffNorm = clamp(summary.spectralRolloffMean / 7200, 0, 1.8);
  const flatness = clamp(summary.spectralFlatnessMean, 0, 1);
  const transient = clamp(summary.transientDensity, 0, 1);
  const harmonic = clamp(summary.harmonicRatio, 0, 1);
  const zcrTexture = clamp(summary.zeroCrossingRateMean * 9, 0, 1);
  const dominantNorm = clamp(summary.dominantFrequencyMean / 1200, 0, 2);
  const lowBand = clamp(summary.lowBandEnergy, 0, 1);
  const tilt = clamp(summary.spectralTilt, -1.5, 1.5);
  const bassMotion = clamp(summary.bassEnvelope.modulationDepth, 0, 1);
  const bankRoughness = clamp(summary.bankRoughness, 0, 1);
  const isTurbo = engineFamilyKey.includes("turbo");
  const isSupercharged = engineFamilyKey.includes("supercharged");

  return {
    combustionEdge: weight(0.68 + transient * 0.58 + clamp(summary.crestFactor / 12, 0, 0.25)),
    exhaustFormantShift: weight(0.82 + (dominantNorm - 0.45) * 0.20 + (centroidNorm - 0.7) * 0.12),
    exhaustBrightness: weight(0.62 + centroidNorm * 0.34 + rolloffNorm * 0.20 - flatness * 0.10),
    orderHarmonicGain: weight(0.62 + harmonic * 0.72 - flatness * 0.16),
    intakeTexture: weight(0.64 + zcrTexture * 0.42 + flatness * 0.34),
    turboWhoosh: weight(isTurbo ? 0.62 + flatness * 0.74 + zcrTexture * 0.25 : DEFAULT_SOUND_TUNING_WEIGHTS.turboWhoosh),
    turboTone: weight(isTurbo ? 0.58 + harmonic * 0.52 + centroidNorm * 0.24 : DEFAULT_SOUND_TUNING_WEIGHTS.turboTone),
    superchargerWhine: weight(isSupercharged ? 0.60 + harmonic * 0.56 + centroidNorm * 0.18 : DEFAULT_SOUND_TUNING_WEIGHTS.superchargerWhine),
    muffling: weight(1.28 - centroidNorm * 0.22 - rolloffNorm * 0.18 + flatness * 0.20),
    clarity: weight(0.70 + harmonic * 0.36 + centroidNorm * 0.22 + rolloffNorm * 0.12 - flatness * 0.20),
    lowOrderGain: weight(0.72 + lowBand * 0.66 + bankRoughness * 0.30 + harmonic * 0.12),
    bodyResonanceGain: weight(0.74 + lowBand * 0.58 + bassMotion * 0.26 + Math.max(0, tilt) * 0.10),
    bassShelf: weight(0.82 + lowBand * 0.72 + Math.max(0, tilt) * 0.20),
    pulseDensitySmoothing: weight(1.12 + harmonic * 0.18 - transient * 0.18 - bankRoughness * 0.10),
    spectralTilt: weight(1 + tilt * 0.22),
  };
}

export function deriveTuningTargetFromAnalysis(analysis: CaptureAnalysis): TuningTarget {
  return {
    id: `target-${analysis.id}`,
    captureId: analysis.captureId,
    analysisId: analysis.id,
    engineFamilyKey: analysis.engineFamilyKey,
    createdAt: analysis.createdAt,
    segmentType: analysis.segmentType,
    perspective: analysis.perspective,
    rpmStart: analysis.rpmStart,
    rpmEnd: analysis.rpmEnd,
    load: analysis.load,
    throttle: analysis.throttle,
    summary: analysis.summary,
    weights: deriveTuningWeightsFromSummary(analysis.summary, analysis.engineFamilyKey),
  };
}

export function validateCaptureAnalysis(analysis: CaptureAnalysis): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!analysis.id.trim()) errors.push("Analysis id is required.");
  if (!analysis.captureId.trim()) errors.push("Capture id is required.");
  if (!analysis.engineFamilyKey.trim()) errors.push("Engine family key is required.");
  if (analysis.sampleRate <= 0) errors.push("Sample rate must be positive.");
  if (analysis.frameSize <= 0 || analysis.hopSize <= 0) errors.push("Frame and hop sizes must be positive.");
  if (analysis.summary.frameCount !== analysis.frames.length) errors.push("Summary frame count must match extracted frames.");
  if (analysis.frames.length === 0) errors.push("At least one analysis frame is required.");
  if (analysis.rpmStart < 0 || analysis.rpmEnd < 0) errors.push("RPM values cannot be negative.");
  if (analysis.load < 0 || analysis.load > 1) errors.push("Load must be between 0 and 1.");
  if (analysis.throttle < 0 || analysis.throttle > 1) errors.push("Throttle must be between 0 and 1.");

  for (const [key, value] of Object.entries(analysis.summary)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      errors.push(`Summary field ${key} must be finite.`);
    }
  }

  for (const [key, value] of Object.entries(deriveTuningWeightsFromSummary(analysis.summary, analysis.engineFamilyKey))) {
    if (!Number.isFinite(value) || value < 0.35 || value > 1.85) {
      errors.push(`Tuning weight ${key} is out of range.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function rpmDistance(target: TuningTarget, rpm: number | undefined): number {
  if (rpm === undefined) return 0;
  const low = Math.min(target.rpmStart, target.rpmEnd);
  const high = Math.max(target.rpmStart, target.rpmEnd);
  if (rpm >= low && rpm <= high) return 0;
  return Math.min(Math.abs(rpm - low), Math.abs(rpm - high)) / 1000;
}

function loadDistance(target: TuningTarget, load: number | undefined): number {
  if (load === undefined) return 0;
  return Math.abs(load - target.load) * 1.8;
}

function familyDistance(targetKey: string, criteriaKey: string | undefined): number {
  if (!criteriaKey) return 0;
  if (targetKey === criteriaKey) return 0;
  const targetParts = targetKey.split(":");
  const criteriaParts = criteriaKey.split(":");
  let mismatch = 0;
  for (let i = 0; i < Math.max(targetParts.length, criteriaParts.length); i++) {
    if (targetParts[i] !== criteriaParts[i]) mismatch += i < 2 ? 0.8 : 0.3;
  }
  return mismatch;
}

export function findClosestTuningTarget(
  targets: TuningTarget[],
  criteria: TuningTargetLookupCriteria,
): TuningTarget | null {
  if (targets.length === 0) return null;
  const engineFamilyKey = criteria.engineFamilyKey ?? (criteria.config ? getEngineFamilyKey(criteria.config) : undefined);

  return targets
    .map((target) => {
      const perspectivePenalty = !criteria.perspective || target.perspective === criteria.perspective
        ? 0
        : target.perspective === "mixed" || criteria.perspective === "mixed"
          ? 0.12
          : 0.35;
      const segmentPenalty = !criteria.segmentType || target.segmentType === criteria.segmentType ? 0 : 0.22;
      return {
        target,
        score:
          familyDistance(target.engineFamilyKey, engineFamilyKey) +
          rpmDistance(target, criteria.rpm) +
          loadDistance(target, criteria.load) +
          perspectivePenalty +
          segmentPenalty,
      };
    })
    .sort((a, b) => a.score - b.score)[0]?.target ?? null;
}
