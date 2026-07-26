import Meyda, { type MeydaAudioFeature, type MeydaFeaturesObject } from "meyda";
import type { EngineConfiguration } from "../../../shared/engineTypes";
import type { AudioAnalysisEngine, AudioAnalysisOptions, AudioFeatureFrame, CaptureAnalysis } from "../../../shared/audioAnalysis";
import {
  analyzePcmReference,
  calculateFrameFeatures,
  createAnalysisId,
  getEngineFamilyKey,
  summarizeFeatureFrames,
} from "../../../shared/audioAnalysis";
import type { ReferenceCaptureSegment } from "../../../shared/referenceCapture";

interface BrowserCaptureAnalysisOptions extends AudioAnalysisOptions {
  engineConfig?: EngineConfiguration;
  useEssentia?: boolean;
}

const MEYDA_FEATURES: MeydaAudioFeature[] = [
  "rms",
  "zcr",
  "spectralCentroid",
  "spectralRolloff",
  "spectralFlatness",
  "mfcc",
  "amplitudeSpectrum",
];

const DEFAULT_FRAME_SIZE = 2048;
const DEFAULT_HOP_SIZE = 1024;
const DEFAULT_MAX_FRAMES = 240;
const STORED_SPECTRUM_BINS = 64;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function spectrumStats(amplitudeSpectrum: number[], sampleRate: number) {
  if (amplitudeSpectrum.length === 0) {
    return { centroid: 0, rolloff: 0, flatness: 0, dominantFrequency: 0 };
  }

  const nyquist = sampleRate / 2;
  let total = 0;
  let weighted = 0;
  let dominant = 0;
  let dominantFrequency = 0;

  for (let i = 0; i < amplitudeSpectrum.length; i++) {
    const magnitude = Math.max(0, amplitudeSpectrum[i] ?? 0);
    const frequency = (i / Math.max(1, amplitudeSpectrum.length - 1)) * nyquist;
    total += magnitude;
    weighted += frequency * magnitude;
    if (magnitude > dominant) {
      dominant = magnitude;
      dominantFrequency = frequency;
    }
  }

  const rolloffTarget = total * 0.85;
  let cumulative = 0;
  let rolloff = 0;
  for (let i = 0; i < amplitudeSpectrum.length; i++) {
    cumulative += Math.max(0, amplitudeSpectrum[i] ?? 0);
    if (cumulative >= rolloffTarget) {
      rolloff = (i / Math.max(1, amplitudeSpectrum.length - 1)) * nyquist;
      break;
    }
  }

  const arithmeticMean = total / amplitudeSpectrum.length || 0;
  const geometricMean = Math.exp(mean(amplitudeSpectrum.map((value) => Math.log(Math.max(value, 1e-12)))));

  return {
    centroid: total > 0 ? weighted / total : 0,
    rolloff,
    flatness: arithmeticMean > 0 ? clamp(geometricMean / arithmeticMean, 0, 1) : 0,
    dominantFrequency,
  };
}

function peakAmplitude(frame: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < frame.length; i++) peak = Math.max(peak, Math.abs(frame[i]));
  return peak;
}

function meydaFrameToFeatureFrame(
  frame: Float32Array,
  sampleRate: number,
  timeSec: number,
  features: Partial<MeydaFeaturesObject> | null,
): AudioFeatureFrame {
  if (!features) return calculateFrameFeatures(frame, sampleRate, timeSec);

  const fallback = calculateFrameFeatures(frame, sampleRate, timeSec);
  const amplitudeSpectrum = Array.from(features.amplitudeSpectrum ?? []);
  const stats = spectrumStats(amplitudeSpectrum, sampleRate);
  const rms = Number.isFinite(features.rms) ? features.rms! : fallback.rms;
  const peak = peakAmplitude(frame);
  const zcrRaw = Number.isFinite(features.zcr) ? features.zcr! : fallback.zeroCrossingRate;
  const zeroCrossingRate = zcrRaw > 1 ? zcrRaw / Math.max(1, frame.length - 1) : zcrRaw;
  const crest = rms > 0 ? peak / rms : 0;

  return {
    timeSec,
    rms,
    peakAmplitude: peak,
    zeroCrossingRate: clamp(zeroCrossingRate, 0, 1),
    spectralCentroid: stats.centroid || fallback.spectralCentroid,
    spectralRolloff: stats.rolloff || fallback.spectralRolloff,
    spectralFlatness: Number.isFinite(features.spectralFlatness) ? clamp(features.spectralFlatness!, 0, 1) : stats.flatness,
    dominantFrequency: stats.dominantFrequency || fallback.dominantFrequency,
    transientScore: clamp((crest - 1.7) / 5.5, 0, 1),
    mfcc: Array.from(features.mfcc ?? fallback.mfcc).slice(0, 13),
    amplitudeSpectrum: downsampleSpectrum(amplitudeSpectrum.length ? amplitudeSpectrum : fallback.amplitudeSpectrum),
  };
}

function extractMeydaFrames(samples: Float32Array, sampleRate: number, options: AudioAnalysisOptions): AudioFeatureFrame[] {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const totalFrames = Math.max(1, Math.floor(Math.max(0, samples.length - frameSize) / hopSize) + 1);
  const frameStride = Math.max(1, Math.ceil(totalFrames / maxFrames));
  const frames: AudioFeatureFrame[] = [];

  Meyda.bufferSize = frameSize;
  Meyda.sampleRate = sampleRate;
  Meyda.numberOfMFCCCoefficients = 13;
  Meyda.melBands = 40;
  Meyda.windowingFunction = "hanning";

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += frameStride) {
    const start = frameIndex * hopSize;
    const frame = new Float32Array(frameSize);
    frame.set(samples.subarray(start, Math.min(samples.length, start + frameSize)));
    const features = Meyda.extract(MEYDA_FEATURES, frame);
    frames.push(meydaFrameToFeatureFrame(frame, sampleRate, start / sampleRate, features));
  }

  return frames;
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      mono[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return mono;
}

async function decodeAudioBlob(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number; durationSec: number }> {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Web Audio decoding is not available in this browser.");
  }

  const audioContext = new AudioContextCtor();
  try {
    const data = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(data.slice(0));
    return {
      samples: downmixToMono(audioBuffer),
      sampleRate: audioBuffer.sampleRate,
      durationSec: audioBuffer.duration,
    };
  } finally {
    void audioContext.close();
  }
}

async function runEssentiaProbe(
  samples: Float32Array,
  sampleRate: number,
  dominantFrequency: number,
): Promise<{ available: boolean; harmonicRatio?: number; notes: string[] }> {
  try {
    const module = await import("essentia.js");
    const EssentiaCtor = module.Essentia ?? module.default?.Essentia;
    const wasm = module.EssentiaWASM ?? module.default?.EssentiaWASM;
    if (!EssentiaCtor || !wasm) {
      return { available: false, notes: ["Essentia.js module loaded without the expected WASM API."] };
    }

    const essentia = new EssentiaCtor(wasm);
    const frameSize = Math.min(DEFAULT_FRAME_SIZE, samples.length);
    const start = Math.max(0, Math.floor((samples.length - frameSize) / 2));
    const frame = Array.from(samples.subarray(start, start + frameSize));
    const frameVector = essentia.arrayToVector(frame);
    const spectrumResult = essentia.Spectrum(frameVector, frameSize);
    const peaks = essentia.SpectralPeaks(
      spectrumResult.spectrum,
      0.00005,
      Math.min(10000, sampleRate / 2),
      32,
      35,
      "frequency",
      sampleRate,
    );
    const frequencies = peaks.frequencies ? Array.from(essentia.vectorToArray(peaks.frequencies)) : [];
    const magnitudes = peaks.magnitudes ? Array.from(essentia.vectorToArray(peaks.magnitudes)) : [];
    const pitch = dominantFrequency > 35 ? dominantFrequency : frequencies[0] ?? 90;
    const harmonicPeaks = frequencies.length > 0 && magnitudes.length > 0
      ? essentia.HarmonicPeaks(peaks.frequencies, peaks.magnitudes, pitch, 16, 0.25)
      : null;
    const harmonicMagnitudes = harmonicPeaks?.harmonicMagnitudes
      ? Array.from(essentia.vectorToArray(harmonicPeaks.harmonicMagnitudes))
      : [];
    const harmonicEnergy = harmonicMagnitudes.reduce((sum, value) => sum + Math.abs(value), 0);
    const peakEnergy = magnitudes.reduce((sum, value) => sum + Math.abs(value), 0);
    essentia.shutdown?.();

    return {
      available: true,
      harmonicRatio: peakEnergy > 0 ? clamp(harmonicEnergy / peakEnergy, 0, 1) : undefined,
      notes: [`Essentia harmonic probe found ${frequencies.length} spectral peaks.`],
    };
  } catch {
    return { available: false, notes: ["Essentia.js optional WASM pass is unavailable; Meyda/fallback summary was used."] };
  }
}

export async function analyzeReferenceCapture(
  blob: Blob,
  capture: ReferenceCaptureSegment,
  options: BrowserCaptureAnalysisOptions = {},
): Promise<CaptureAnalysis> {
  const decoded = await decodeAudioBlob(blob);
  const engineConfig = options.engineConfig ?? capture.engineConfig;
  const engineFamilyKey = options.engineConfig || capture.engineConfig
    ? getEngineFamilyKey(engineConfig!)
    : "unknown";

  const metadata = {
    captureId: capture.id,
    segmentType: capture.segmentType,
    perspective: capture.perspective,
    rpmStart: capture.rpmStart,
    rpmEnd: capture.rpmEnd,
    load: capture.load,
    throttle: capture.throttle,
    engineConfig,
    engineFamilyKey,
  };

  let frames: AudioFeatureFrame[];
  let engines: AudioAnalysisEngine[];
  let notes: string[] = [];

  try {
    frames = extractMeydaFrames(decoded.samples, decoded.sampleRate, options);
    engines = ["meyda"];
  } catch {
    const fallback = analyzePcmReference(decoded.samples, decoded.sampleRate, metadata, {
      ...options,
      engines: ["fallback"],
    });
    frames = fallback.frames;
    engines = ["fallback"];
    notes = ["Meyda extraction failed in this browser; fallback spectral analysis was used."];
  }

  let summary = summarizeFeatureFrames(frames, decoded.sampleRate, decoded.durationSec, engines, notes, {
    rpmStart: capture.rpmStart,
    rpmEnd: capture.rpmEnd,
  });

  if (options.useEssentia !== false) {
    const probe = await runEssentiaProbe(decoded.samples, decoded.sampleRate, summary.dominantFrequencyMean);
    if (probe.available) {
      engines = Array.from(new Set([...engines, "essentia"]));
      summary = {
        ...summary,
        engines,
        notes: [...summary.notes, ...probe.notes],
        harmonicRatio: probe.harmonicRatio !== undefined
          ? clamp(summary.harmonicRatio * 0.72 + probe.harmonicRatio * 0.28, 0, 1)
          : summary.harmonicRatio,
      };
    } else if (probe.notes.length > 0) {
      summary = {
        ...summary,
        notes: [...summary.notes, ...probe.notes],
      };
    }
  }

  const createdAt = new Date();
  return {
    id: createAnalysisId(capture.id, createdAt),
    captureId: capture.id,
    createdAt: createdAt.toISOString(),
    engineFamilyKey,
    segmentType: capture.segmentType,
    perspective: capture.perspective,
    rpmStart: capture.rpmStart,
    rpmEnd: capture.rpmEnd,
    load: capture.load,
    throttle: capture.throttle,
    sampleRate: decoded.sampleRate,
    frameSize: options.frameSize ?? DEFAULT_FRAME_SIZE,
    hopSize: options.hopSize ?? DEFAULT_HOP_SIZE,
    engines,
    summary,
    frames,
  };
}
