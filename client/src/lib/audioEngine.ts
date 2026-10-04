/**
 * Engine Sound Simulator - Hybrid Audio Engine
 *
 * Real-time Web Audio playback plus offline export, driven by the shared
 * mechanical firing model in shared/engineSoundModel.ts.
 */

/// <reference lib="dom" />

import type { EngineConfiguration, ListenerPerspective, PlaybackState } from "../../../shared/engineTypes";
import { DEFAULT_ENGINE_CONFIG, isBaselineSoundProfile, isClaritySoundProfile, isPhysicalSoundProfile, normalizeSoundProfile } from "../../../shared/engineTypes";
import { buildEngineSoundAnalysis, generateEnginePcm, resolveSoundTuningWeights } from "../../../shared/engineSoundModel";
import { resolveLiveOutputGain, resolveRealtimeAudioMixProfile } from "../../../shared/realtimeAudioMix";
import { renderEssPcm } from "../../../shared/ess/render";
import type { DriveMode, EngineTelemetry, StemGains } from "../../../shared/ess/engine";
import essProcessorUrl from "./ess/essProcessor?worker&url";

export const COMBUSTION_PROCESSOR_CODE = `
function shapeClarityOutput(input) {
  const sign = input < 0 ? -1 : 1;
  const magnitude = Math.abs(input);
  const knee = 0.74;
  if (magnitude <= knee) return input;

  const headroom = 1 - knee;
  const shaped = knee + headroom * (1 - Math.exp(-(magnitude - knee) / headroom));
  return sign * Math.min(1, Math.max(0, shaped));
}

function normalizeSoundProfile(soundProfile) {
  if (soundProfile === 'baseline') return 'v0';
  if (soundProfile === 'clean') return 'v8';
  if (soundProfile === 'clarity') return 'v9';
  return soundProfile || 'v15';
}

function isBaselineProfile(soundProfile) {
  return normalizeSoundProfile(soundProfile) === 'v0';
}

function isClarityProfile(soundProfile) {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v9' || normalized === 'v10' || normalized === 'v11' || normalized === 'v12' || normalized === 'v13' || normalized === 'v14' || normalized === 'v15';
}

function isCylinderBalanceProfile(soundProfile) {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v10' || normalized === 'v11' || normalized === 'v12' || normalized === 'v13' || normalized === 'v14' || normalized === 'v15';
}

function isStereoStabilityProfile(soundProfile) {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v11' || normalized === 'v12' || normalized === 'v13' || normalized === 'v14' || normalized === 'v15';
}

function isAccessoryQualityProfile(soundProfile) {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v12' || normalized === 'v13' || normalized === 'v14' || normalized === 'v15';
}

function isAirwashControlProfile(soundProfile) {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v13' || normalized === 'v14' || normalized === 'v15';
}

function isStaticCleanProfile(soundProfile) {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v14' || normalized === 'v15';
}

function isCleanHandoffProfile(soundProfile) {
  return normalizeSoundProfile(soundProfile) === 'v15';
}

class CombustionProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rpm = 850;
    this.throttle = 0;
    this.load = 0.2;
    this.crankAngleDeg = 0;
    this.nextFireAbsDeg = 0;
    this.eventIndex = 0;
    this.pulses = [];
    this.seed = 42;
    this.rumblePhase = 0;
    this.intakePhase = 0;
    this.intakeResonancePhase = 0;
    this.boostPhase = 0;
    this.mechPhase = 0;
    this.mechanicalNoise = 0;
    this.mechanicalNoiseLow = 0;
    this.mechanicalTickEnvelope = 0;
    this.intakeNoise = 0;
    this.intakeNoiseLow = 0;
    this.turboSpool = 0;
    this.turboWhooshFast = 0;
    this.turboWhooshSlow = 0;
    this.turboFlutterPhase = 0;
    this.superchargerLobePhase = 0;
    this.superchargerGearPhase = 0;
    this.superchargerNoise = 0;
    this.combustionEnvelope = 0;
    this.combustionEdgeEnvelope = 0;
    this.previousLeftInput = 0;
    this.previousRightInput = 0;
    this.previousLeftOutput = 0;
    this.previousRightOutput = 0;
    this.analysis = this.defaultAnalysis();
    this.sound = {
      redline: 6500,
      forcedType: 'na',
      turboSpoolThreshold: 2000,
      turboSize: 'balanced',
      maxBoost: 15,
      wastegateEnabled: true,
      superchargerType: 'roots',
      whineIntensity: 0.6,
      audioProfile: 'v15',
      layout: 'v',
      crankshaft: 'cross-plane',
      exhaustCharacter: 'sport',
      exhaustRouting: 'dual',
      headerGeometry: 'equal-length',
      tuning: {
        combustionEdge: 1,
        exhaustFormantShift: 1,
        exhaustBrightness: 1,
        orderHarmonicGain: 1,
        intakeTexture: 1,
        turboWhoosh: 1,
        turboTone: 1,
        superchargerWhine: 1,
        muffling: 1,
        clarity: 1,
        lowOrderGain: 1,
        bodyResonanceGain: 1,
        bassShelf: 1,
        pulseDensitySmoothing: 1,
        spectralTilt: 1,
      },
    };

    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.reset) this.resetSynthesisState();
      if (data.rpm !== undefined) this.rpm = data.rpm;
      if (data.throttle !== undefined) this.throttle = data.throttle;
      if (data.load !== undefined) this.load = data.load;
      if (data.analysis) {
        this.analysis = data.analysis;
        this.resetSynthesisState();
      }
      if (data.sound) this.sound = { ...this.sound, ...data.sound };
      if (data.seed !== undefined) this.seed = data.seed >>> 0;
    };
  }

  resetSynthesisState() {
    this.crankAngleDeg = 0;
    this.nextFireAbsDeg = 0;
    this.eventIndex = 0;
    this.pulses = [];
    this.mechanicalNoise = 0;
    this.mechanicalNoiseLow = 0;
    this.mechanicalTickEnvelope = 0;
    this.intakeNoise = 0;
    this.intakeNoiseLow = 0;
    this.turboSpool = 0;
    this.turboWhooshFast = 0;
    this.turboWhooshSlow = 0;
    this.turboFlutterPhase = 0;
    this.superchargerLobePhase = 0;
    this.superchargerGearPhase = 0;
    this.superchargerNoise = 0;
    this.intakeResonancePhase = 0;
    this.combustionEnvelope = 0;
    this.combustionEdgeEnvelope = 0;
    this.previousLeftInput = 0;
    this.previousRightInput = 0;
    this.previousLeftOutput = 0;
    this.previousRightOutput = 0;
  }

  defaultAnalysis() {
    const events = Array.from({ length: 8 }, (_, index) => ({
      cylinder: index + 1,
      sequenceIndex: index,
      angleDeg: index * 90,
      intervalDeg: 90,
      bankIndex: index % 2,
      pan: index % 2 === 0 ? -0.42 : 0.42,
      pipeDelaySec: 0.001,
      amplitude: 1,
      toneOffset: 0,
      resonanceSkew: 1 + (index % 3 - 1) * 0.025,
      bodyBias: 1 + (index % 4 - 1.5) * 0.025,
      throatBias: 1 + (index % 5 - 2) * 0.030,
      blowdownBias: 1 + (index % 6 - 2.5) * 0.028,
    }));
    return {
      cylinderCount: 8,
      cycleDegrees: 720,
      bankCount: 2,
      firingOrder: [1, 8, 4, 3, 6, 5, 7, 2],
      intervalsDeg: Array(8).fill(90),
      events,
      perCylinderDisplacement: 0.625,
      exhaustBrightness: 0.58,
      exhaustGain: 0.84,
      intakeGain: 0.22,
      idleInstability: 0.025,
      acousticProfile: {
        cycleHz: 1000 / 120,
        firingEventHz: (1000 / 120) * 8,
        perceivedPitchIndex: 0.82,
        lowOrderEnergy: 0.62,
        bankRoughness: 0.58,
        pulseDensitySmoothing: 0.92,
        bassShelf: 1.26,
        spectralTilt: 1.14,
        bodyResonanceGain: 1.32,
        orderSpectrum: Array.from({ length: 32 }, (_, index) => ({
          cycleOrder: index + 1,
          engineOrder: (index + 1) / 2,
          frequencyHz: ((index + 1) * 1000) / 120,
          wholeEngineGain: (index + 1) % 8 === 0 ? 1 : 0,
          bankGains: [0.2, 0.2],
          bankDifference: index < 6 ? 0.36 : 0.04,
          phaseRad: 0,
        })),
        resonanceModes: [
          { name: 'exhaust-quarter', frequencyHz: 27, gain: 0.78, decaySec: 0.12, q: 0.72 },
          { name: 'block-body', frequencyHz: 65, gain: 0.95, decaySec: 0.09, q: 0.92 },
          { name: 'primary-pipe', frequencyHz: 107, gain: 0.68, decaySec: 0.04, q: 1.34 },
          { name: 'intake-runner', frequencyHz: 268, gain: 0.30, decaySec: 0.026, q: 1.25 },
        ],
        familyPreset: {
          id: 'cross-plane-v8',
          lowOrderGain: 1.38,
          bodyResonanceGain: 1.32,
          bassShelf: 1.26,
          pulseDensitySmoothing: 0.92,
          spectralTilt: 1.14,
          highOrderGain: 0.90,
          perceivedPitchBias: -0.13,
          geometry: { primaryTubeLengthCm: 80, exhaustLengthCm: 326, mufflerVolumeL: 25, intakeRunnerLengthCm: 32 },
        },
        geometry: { primaryTubeLengthCm: 80, exhaustLengthCm: 326, mufflerVolumeL: 25, intakeRunnerLengthCm: 32 },
      },
    };
  }

  random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  tune(name, fallback = 1) {
    const value = this.sound.tuning && this.sound.tuning[name];
    return Number.isFinite(value) ? Math.min(1.85, Math.max(0.35, value)) : fallback;
  }

  addPulse(event) {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    event.amplitude = Number.isFinite(event.amplitude) ? event.amplitude : 1;
    event.pan = clamp(Number.isFinite(event.pan) ? event.pan : 0, -0.98, 0.98);
    event.pipeDelaySec = clamp(Number.isFinite(event.pipeDelaySec) ? event.pipeDelaySec : 0.001, 0, 0.030);
    event.toneOffset = Number.isFinite(event.toneOffset) ? event.toneOffset : 0;
    event.resonanceSkew = Number.isFinite(event.resonanceSkew) ? event.resonanceSkew : 1;
    event.bodyBias = Number.isFinite(event.bodyBias) ? event.bodyBias : 1;
    event.throatBias = Number.isFinite(event.throatBias) ? event.throatBias : 1;
    event.blowdownBias = Number.isFinite(event.blowdownBias) ? event.blowdownBias : 1;

    const soundProfile = normalizeSoundProfile(this.sound.audioProfile);
    const cleanProfile = !isBaselineProfile(soundProfile);
    const clarityProfile = isClarityProfile(soundProfile);
    const cylinderBalanceProfile = isCylinderBalanceProfile(soundProfile);
    const stereoStabilityProfile = isStereoStabilityProfile(soundProfile);
    const accessoryQualityProfile = isAccessoryQualityProfile(soundProfile);
    const airwashControlProfile = isAirwashControlProfile(soundProfile);
    const staticCleanProfile = isStaticCleanProfile(soundProfile);
    const cleanHandoffProfile = isCleanHandoffProfile(soundProfile);
    const clarity = cleanProfile ? this.tune('clarity') : 1;
    const muffling = cleanProfile ? this.tune('muffling') : 1;
    const brightnessWeight = cleanProfile ? this.tune('exhaustBrightness') : 1;
    const edgeWeight = cleanProfile ? this.tune('combustionEdge') : 1;
    const formantShift = cleanProfile ? this.tune('exhaustFormantShift') : 1;
    const lowOrderGain = cleanProfile ? this.tune('lowOrderGain') : 1;
    const bodyResonanceGain = cleanProfile ? this.tune('bodyResonanceGain') : 1;
    const bassShelf = cleanProfile ? this.tune('bassShelf') : 1;
    const pulseDensitySmoothing = cleanProfile ? this.tune('pulseDensitySmoothing') : 1;
    const spectralTilt = cleanProfile ? this.tune('spectralTilt') : 1;
    const rpmNorm = clamp(this.rpm / Math.max(1, this.sound.redline), 0, 1.4);
    const power = (0.22 + this.throttle * 0.78) * (0.62 + this.load * 0.38);
    const perCylinder = this.analysis.perCylinderDisplacement || 0.5;
    const cylinderCount = Math.max(1, this.analysis.cylinderCount || 8);
    const highRpmJitterTrim = cleanHandoffProfile
      ? clamp(1 - Math.max(0, rpmNorm - 0.62) * (cylinderCount >= 10 ? 1.45 : 1.25), cylinderCount >= 10 ? 0.30 : 0.38, 1)
      : 1;
    const highRpmMechanicalTrim = cleanHandoffProfile
      ? clamp(1 - Math.max(0, rpmNorm - 0.72) * 0.92, 0.58, 1)
      : 1;
    const acoustic = this.analysis.acousticProfile || this.defaultAnalysis().acousticProfile;
    const modes = acoustic.resonanceModes || [];
    const exhaustMode = modes.find((mode) => mode.name === 'exhaust-quarter') || modes[0] || { frequencyHz: 42, gain: 0.7 };
    const bodyMode = modes.find((mode) => mode.name === 'block-body') || modes[1] || exhaustMode;
    const primaryMode = modes.find((mode) => mode.name === 'primary-pipe') || modes[2] || bodyMode;
    const tunedLowOrder = clamp((0.82 + (acoustic.lowOrderEnergy || 0) * 0.58 + (acoustic.bankRoughness || 0) * 0.26) * lowOrderGain, 0.45, 1.95);
    const tunedBody = clamp((acoustic.bodyResonanceGain || 1) * bodyResonanceGain, 0.45, 1.95);
    const tunedBass = clamp((acoustic.bassShelf || 1) * bassShelf, 0.45, 1.95);
    const tunedSmoothing = clamp((acoustic.pulseDensitySmoothing || 1) * pulseDensitySmoothing, 0.55, 1.75);
    const tunedTilt = clamp((acoustic.spectralTilt || 1) * spectralTilt, 0.45, 1.85);
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
    const cylinderResonance = clarityProfile ? clamp(event.resonanceSkew || 1, 0.90, 1.10) : 1;
    const cylinderBodyBias = clarityProfile ? clamp(event.bodyBias || 1, 0.86, 1.14) : 1;
    const cylinderThroatBias = clarityProfile ? clamp(event.throatBias || 1, 0.80, 1.20) : 1;
    const cylinderBlowdownBias = clarityProfile ? clamp(event.blowdownBias || 1, 0.76, 1.24) : 1;
    const flatPlanePipe = this.sound.crankshaft === 'flat-plane';
    const flatPlaneBright = flatPlanePipe ? 0.96 : 1;
    const layoutDepth = this.sound.layout === 'flat' ? 0.92 : this.sound.layout === 'inline' ? 1.05 : this.sound.layout === 'radial' ? 0.82 : 1;
    const openExhaust = this.sound.exhaustRouting === 'open-headers' || this.sound.exhaustCharacter === 'straight-pipe';
    const headerUnequal = this.sound.headerGeometry === 'unequal-length' ? 1 : 0;
    const v12AirTrim = airwashControlProfile
      ? staticCleanProfile
        ? cleanHandoffProfile
          ? 0
          : clamp(0.010 + this.load * 0.020 + brightnessWeight * 0.008, 0.010, 0.045)
        : clamp(0.08 + this.load * 0.07 + brightnessWeight * 0.02, 0.08, 0.22)
      : accessoryQualityProfile ? clamp(0.66 + this.load * 0.16 + brightnessWeight * 0.04, 0.66, 0.90) : 1;
    const v12PresenceTrim = airwashControlProfile
      ? staticCleanProfile
        ? cleanHandoffProfile
          ? clamp(0.30 + this.load * 0.04, 0.30, 0.40)
          : clamp(0.42 + this.load * 0.06, 0.42, 0.54)
        : clamp(0.52 + this.load * 0.07, 0.52, 0.64)
      : accessoryQualityProfile ? clamp(0.80 + this.load * 0.10, 0.80, 0.91) : 1;
    const v12BodyLift = airwashControlProfile
      ? staticCleanProfile
        ? cleanHandoffProfile
          ? clamp(1.24 + this.load * 0.12, 1.24, 1.36)
          : clamp(1.16 + this.load * 0.10, 1.16, 1.26)
        : clamp(1.10 + this.load * 0.08, 1.10, 1.18)
      : accessoryQualityProfile ? clamp(1.04 + this.load * 0.06, 1.04, 1.10) : 1;
    const subHz = cleanProfile
      ? clamp(exhaustMode.frequencyHz * cylinderResonance * (1 + this.load * 0.07 + event.toneOffset * 0.006), 28, 135)
      : 38 + perCylinder * 42 + this.load * 12;
    const baselineBodyHz = 46 + perCylinder * 58 + this.load * 18 + event.toneOffset * 4;
    const bodyHz = cleanProfile
      ? clamp(bodyMode.frequencyHz * layoutDepth * cylinderResonance * (1 + this.load * 0.09 + event.toneOffset * 0.010), 38, 145)
      : baselineBodyHz;
    const growlHz = cleanProfile
      ? clamp(primaryMode.frequencyHz * (this.sound.crankshaft === 'flat-plane' ? 1.52 : this.sound.crankshaft === 'cross-plane' ? 1.18 : 1.30) + bodyHz * 0.36, 90, 380)
      : bodyHz * (2.05 + event.toneOffset * 0.03);
    const pipeHz = cleanProfile
      ? Math.min(1250, Math.max(180,
        (primaryMode.frequencyHz * (flatPlanePipe ? 2.78 : 2.34) +
          this.analysis.exhaustBrightness * (flatPlanePipe ? 360 : 320) +
          perCylinder * 46 +
          this.load * 38) *
          flatPlaneBright +
          event.toneOffset * (flatPlanePipe ? 120 : 65) +
          headerUnequal * event.toneOffset * 42
      )) * formantShift * cylinderResonance
      : 150 + this.analysis.exhaustBrightness * 360 + perCylinder * 52;
    const presenceHz = cleanProfile
      ? clamp(pipeHz * (clarityProfile ? 2.45 : 2.05) + primaryMode.frequencyHz * 3.2 + event.toneOffset * 170, 850, 5200)
      : clamp(pipeHz * 1.9, 650, 4200);
    const presenceGain = cleanProfile
      ? clamp(
        (clarityProfile ? 2.15 : 0.72) *
          (0.48 + this.analysis.exhaustBrightness * 0.42 + this.load * 0.22) *
          clamp(clarity / Math.max(0.82, muffling), 0.58, 1.55) *
          v12PresenceTrim,
        0.18,
        2.20
      )
      : 0.45;
    const airBurstGain = clarityProfile
      ? clamp((0.070 + this.analysis.exhaustBrightness * 0.085 + this.load * 0.045) * clamp(clarity / Math.max(0.86, muffling), 0.65, 1.55) * v12AirTrim, staticCleanProfile ? 0 : airwashControlProfile ? 0.006 : 0.026, 0.320)
      : 0;
    const pressureSkew = clarityProfile
      ? clamp(0.82 + this.load * 0.36 + this.analysis.exhaustBrightness * 0.18 + event.toneOffset * 0.06, 0.55, 1.42)
      : 1;
    const pipeChirp = clarityProfile
      ? (this.random() > 0.5 ? 1 : -1) *
        clamp(0.62 + this.analysis.exhaustBrightness * 0.64 + this.load * 0.42 + Math.abs(event.toneOffset) * 0.035, 0.35, 2.15)
      : 0;
    const throatGain = clarityProfile
      ? clamp((0.028 + this.analysis.exhaustBrightness * 0.034 + this.load * 0.024) * cylinderThroatBias * clamp(clarity / Math.max(0.82, muffling), 0.62, 1.45), 0.018, 0.115)
      : 0;
    const blowdownGain = clarityProfile
      ? clamp(
        (0.026 + this.analysis.exhaustBrightness * 0.044 + this.load * 0.030 + (openExhaust ? 0.014 : 0)) *
          cylinderBlowdownBias *
          clamp(clarity / Math.max(0.82, muffling), 0.62, 1.45),
        0.014,
        0.135
      )
      : 0;
    const blowdownPhase = clarityProfile ? this.random() * Math.PI * 2 : 0;
    const radiationGain = clarityProfile
      ? clamp(
        (0.018 + this.analysis.exhaustBrightness * 0.030 + this.load * 0.022 + (openExhaust ? 0.012 : 0)) *
          cylinderBlowdownBias *
          clamp(clarity / Math.max(0.84, muffling), 0.62, 1.45) *
          v12AirTrim,
        staticCleanProfile ? 0 : airwashControlProfile ? 0.0025 : 0.010,
        0.105
      )
      : 0;
    const radiationPhase = clarityProfile ? this.random() * Math.PI * 2 : 0;
    const geometry = (acoustic && acoustic.geometry) || { exhaustLengthCm: 300, mufflerVolumeL: 18 };
    const pipeTravelSec = clarityProfile ? (geometry.exhaustLengthCm / 100) / 343 : 0;
    const reflectionDelayA = clarityProfile
      ? clamp(pipeTravelSec * (0.38 + this.random() * 0.16) + event.pipeDelaySec * 0.45, 0.0012, 0.0075)
      : 0;
    const reflectionDelayB = clarityProfile
      ? clamp(pipeTravelSec * (0.72 + this.random() * 0.24) + event.pipeDelaySec * 0.70, 0.0024, 0.0140)
      : 0;
    const reflectionGain = clarityProfile
      ? clamp(
        (0.26 + this.analysis.exhaustBrightness * 0.18 + this.load * 0.16) *
          (openExhaust ? 1.28 : 1) /
          Math.sqrt(Math.max(0.7, geometry.mufflerVolumeL / 12)),
        0.10,
        0.62
      )
      : 0;
    const scatterHzA = clarityProfile ? clamp(presenceHz * (0.72 + this.random() * 0.86), 1200, 7400) : presenceHz;
    const scatterHzB = clarityProfile ? clamp(presenceHz * (1.18 + this.random() * 1.10), 1600, 9000) : presenceHz * 1.57;
    const scatterPhaseA = clarityProfile ? this.random() * Math.PI * 2 : 0;
    const scatterPhaseB = clarityProfile ? this.random() * Math.PI * 2 : 0;
    const decaySec = cleanProfile
      ? Math.min(0.092, Math.max(0.013,
        (0.042 + perCylinder * 0.016 - rpmNorm * 0.018 + (fewCylinderPunch - 1) * 0.016 + (tunedBass - 1) * 0.010 + (tunedSmoothing - 1) * 0.012 - (1 - highCylinderSmooth) * 0.006) *
          clamp(1 + (muffling - 1) * 0.20 - (clarity - 1) * 0.10, 0.82, 1.18)
      ))
      : Math.min(0.080, Math.max(0.016, 0.046 + perCylinder * 0.018 - rpmNorm * 0.017));
    const crackle = cleanProfile
      ? (0.065 + this.analysis.exhaustBrightness * 0.18) *
        (openExhaust ? 1.35 : 1) *
        Math.min(1.65, Math.max(0.45, edgeWeight * clarity / Math.max(0.7, muffling))) *
        (accessoryQualityProfile ? clamp(0.72 + this.load * 0.12, 0.70, 0.86) : 1)
      : 0.18 + this.analysis.exhaustBrightness * 0.38;
    const combustionVariance = cleanProfile ? 1 + (this.random() - 0.5) * 0.10 * highRpmJitterTrim : 1;
    const microDelaySec = cleanProfile
      ? (this.random() - 0.5) * (cleanHandoffProfile ? 0.00022 * clamp(0.42 + highRpmJitterTrim * 0.58, 0.42, 1) : 0.00022)
      : 0;
    const resonatorDrift = cleanProfile ? 1 + (this.random() - 0.5) * (0.045 + brightnessWeight * 0.012) * highRpmJitterTrim : 1;
    const startupTransientLift = clarityProfile && this.crankAngleDeg < 1440 ? 1.10 : 1;
    this.pulses.push({
      ageSec: -(event.pipeDelaySec + microDelaySec),
      amp: event.amplitude *
        power *
        this.analysis.exhaustGain *
        startupTransientLift *
        (openExhaust ? 1.15 : 1) *
        (cleanProfile ? fewCylinderPunch * highCylinderSmooth * perEventEnergy : 1) *
        combustionVariance *
        Math.min(1.14, Math.max(0.78, 0.92 + clarity * 0.10 - muffling * 0.04)),
      pan: event.pan,
      decaySec,
      subHz,
      subGain: cleanProfile ? tunedBass * tunedLowOrder * exhaustMode.gain * (0.52 + this.load * 0.48) * v12BodyLift : 0.75,
      bodyHz,
      bodyGain: cleanProfile ? tunedBody * bodyMode.gain * (0.78 + this.load * 0.30) * cylinderBodyBias * v12BodyLift : 1,
      growlHz,
      pipeHz: pipeHz * resonatorDrift,
      pipeGain: cleanProfile ? primaryMode.gain * clamp(1.18 - (tunedTilt - 1) * 0.25 + brightnessWeight * 0.08, 0.65, 1.35) : 1,
      presenceHz: presenceHz * (clarityProfile ? 1 + (this.random() - 0.5) * 0.160 * highRpmJitterTrim : 1),
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
      const eventStrength = event.amplitude * power * (0.52 + this.load * 0.48) * clamp(this.analysis.exhaustGain, 0.55, 1.35);
      this.combustionEnvelope = clamp((this.combustionEnvelope || 0) + eventStrength * 0.105, 0, 1.20);
      this.combustionEdgeEnvelope = clamp((this.combustionEdgeEnvelope || 0) + eventStrength * 0.48, 0, 1.65);
      const cylinderIdentity = clamp(0.92 + Math.abs(event.toneOffset) * 0.035 + (cylinderThroatBias - 1) * 0.18, 0.82, 1.20);
      const mechanicalStrike = eventStrength *
        (0.18 + rpmNorm * 0.16) *
        cylinderIdentity *
        clamp(1.12 - tunedSmoothing * 0.08 + (acoustic.bankRoughness || 0) * 0.10, 0.78, 1.18) *
        highRpmMechanicalTrim;
      this.mechanicalTickEnvelope = clamp((this.mechanicalTickEnvelope || 0) + mechanicalStrike, 0, 1.70);
    }
    const maxActivePulses = cleanProfile
      ? stereoStabilityProfile
        ? cylinderCount >= 10 ? (rpmNorm > 0.88 ? 46 : 58) : rpmNorm > 0.88 ? 40 : 48
        : cylinderBalanceProfile
          ? cylinderCount >= 10 ? (rpmNorm > 0.88 ? 58 : 64) : rpmNorm > 0.88 ? 42 : 48
        : cylinderCount >= 10 ? 28 : rpmNorm > 0.88 ? 34 : 44
      : 64;
    if (this.pulses.length > maxActivePulses) this.pulses.splice(0, this.pulses.length - maxActivePulses);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const leftChannel = output[0];
    const rightChannel = output[1] || output[0];
    if (!leftChannel) return true;

    const sr = sampleRate;
    const twoPi = Math.PI * 2;
    const events = this.analysis.events && this.analysis.events.length ? this.analysis.events : this.defaultAnalysis().events;
    const soundProfile = normalizeSoundProfile(this.sound.audioProfile);
    const cleanProfile = !isBaselineProfile(soundProfile);
    const clarityProfile = isClarityProfile(soundProfile);
    const cylinderBalanceProfile = isCylinderBalanceProfile(soundProfile);
    const stereoStabilityProfile = isStereoStabilityProfile(soundProfile);
    const accessoryQualityProfile = isAccessoryQualityProfile(soundProfile);
    const airwashControlProfile = isAirwashControlProfile(soundProfile);
    const staticCleanProfile = isStaticCleanProfile(soundProfile);
    const cleanHandoffProfile = isCleanHandoffProfile(soundProfile);
    const clarity = cleanProfile ? this.tune('clarity') : 1;
    const muffling = cleanProfile ? this.tune('muffling') : 1;
    const brightnessWeight = cleanProfile ? this.tune('exhaustBrightness') : 1;
    const edgeWeight = cleanProfile ? this.tune('combustionEdge') : 1;
    const orderWeight = cleanProfile ? this.tune('orderHarmonicGain') : 1;
    const intakeTexture = cleanProfile ? this.tune('intakeTexture') : 1;
    const turboWhoosh = cleanProfile ? this.tune('turboWhoosh') : 1;
    const turboTone = cleanProfile ? this.tune('turboTone') : 1;
    const superchargerWhine = cleanProfile ? this.tune('superchargerWhine') : 1;
    const lowOrderGain = cleanProfile ? this.tune('lowOrderGain') : 1;
    const bodyResonanceGain = cleanProfile ? this.tune('bodyResonanceGain') : 1;
    const bassShelf = cleanProfile ? this.tune('bassShelf') : 1;
    const spectralTilt = cleanProfile ? this.tune('spectralTilt') : 1;
    const acoustic = this.analysis.acousticProfile || this.defaultAnalysis().acousticProfile;
    const modes = acoustic.resonanceModes || [];
    const intakeMode = modes.find((mode) => mode.name === 'intake-runner') || modes[3] || modes[0] || { frequencyHz: 280 };

    for (let i = 0; i < leftChannel.length; i++) {
      const rpm = Math.max(80, this.rpm);
      const rpmNorm = Math.min(1.3, Math.max(0, rpm / Math.max(1, this.sound.redline)));
      const cylinderCount = Math.max(1, this.analysis.cylinderCount || 8);
      this.crankAngleDeg += (rpm * 6) / sr;

      while (this.nextFireAbsDeg <= this.crankAngleDeg) {
        const event = events[this.eventIndex % events.length];
        this.addPulse(event);
        this.nextFireAbsDeg += event.intervalDeg || 720 / events.length;
        this.eventIndex = (this.eventIndex + 1) % events.length;
      }

      if (this.crankAngleDeg > 720000) {
        this.crankAngleDeg -= 720000;
        this.nextFireAbsDeg -= 720000;
      }

      let left = 0;
      let right = 0;
      const denseStereoWidth = stereoStabilityProfile && cylinderCount >= 10
        ? Math.min(0.48, Math.max(0.16, 0.48 - Math.max(0, cylinderCount - 8) * 0.055 - Math.max(0, rpmNorm - 0.65) * 0.22))
        : 1;
      const highRpmFineTrim = cleanHandoffProfile
        ? Math.min(1, Math.max(cylinderCount >= 10 ? 0.35 : 0.42, 1 - Math.max(0, rpmNorm - 0.66) * (cylinderCount >= 10 ? 1.65 : 1.45)))
        : 1;
      const highRpmPresenceTrim = cleanHandoffProfile
        ? Math.min(1, Math.max(cylinderCount >= 10 ? 0.40 : 0.48, 1 - Math.max(0, rpmNorm - 0.66) * (cylinderCount >= 10 ? 1.35 : 1.15)))
        : 1;

      for (let p = this.pulses.length - 1; p >= 0; p--) {
        const pulse = this.pulses[p];
        if (
          !Number.isFinite(pulse.amp) ||
          !Number.isFinite(pulse.pan) ||
          !Number.isFinite(pulse.decaySec) ||
          pulse.decaySec <= 0
        ) {
          this.pulses.splice(p, 1);
          continue;
        }

        pulse.ageSec += 1 / sr;
        if (pulse.ageSec < 0) continue;
        const age = pulse.ageSec;
        const highRpmStableDetail = stereoStabilityProfile && cylinderCount >= 10 && rpmNorm > 0.92;
        const realtimeLeanDetail = clarityProfile && !cylinderBalanceProfile && (cylinderCount >= 10 || rpmNorm > 0.82);
        const earlyDetail = clarityProfile && age < (highRpmStableDetail ? 0.018 : realtimeLeanDetail ? 0.018 : cylinderBalanceProfile && cylinderCount >= 10 ? 0.023 : 0.026);
        const transientDetail = clarityProfile && age < (highRpmStableDetail ? 0.036 : realtimeLeanDetail ? 0.036 : cylinderBalanceProfile && cylinderCount >= 10 ? 0.047 : 0.052);
        const attack = 1 - Math.exp(-age / 0.00045);
        const env = attack * Math.exp(-age / pulse.decaySec);
        const subEnv = attack * Math.exp(-age / (pulse.decaySec * (cleanProfile ? 1.82 : 1.25)));
        const crackEnv = Math.exp(-age / 0.0045);
        const pipeEnv = Math.exp(-age / (pulse.decaySec * (cleanProfile ? 0.38 : 0.65)));
        const presenceEnv = Math.exp(-age / (clarityProfile ? 0.0095 : 0.0062));
        const bodyGain = cleanProfile ? Math.min(1.24, Math.max(0.78, 1.04 + (muffling - 1) * 0.16 - (clarity - 1) * 0.06)) : 1;
        const pipeGain = cleanProfile
          ? Math.min(2.55, Math.max(0.45, (clarityProfile ? 1.96 : 0.74) + brightnessWeight * 0.20 + clarity * 0.16 - muffling * 0.10))
          : 1;
        const eventEdgeGain = cleanProfile ? Math.min(1.72, Math.max(0.42, edgeWeight * clarity / Math.max(0.72, muffling))) : 1;
        const smoothTransient = cleanProfile
          ? stereoStabilityProfile
            ? Math.min(1.10, Math.max(0.54, 1.02 - ((acoustic.pulseDensitySmoothing || 1) - 1) * 0.38 - Math.max(0, cylinderCount - 8) * (rpmNorm > 0.90 ? 0.034 : 0.026)))
            : cylinderBalanceProfile
              ? Math.min(1.10, Math.max(0.58, 1.02 - ((acoustic.pulseDensitySmoothing || 1) - 1) * 0.34 - Math.max(0, cylinderCount - 8) * 0.026))
            : Math.min(1.10, Math.max(0.48, 1.02 - ((acoustic.pulseDensitySmoothing || 1) - 1) * 0.45 - Math.max(0, cylinderCount - 8) * 0.060))
          : 1;
        let pressureStep = 0;
        if (!clarityProfile || transientDetail) {
          const pressureRise = Math.exp(-age / (clarityProfile ? 0.0026 : 0.003)) - Math.exp(-age / (clarityProfile ? 0.00034 : 0.00055));
          const pressureTail = clarityProfile ? (Math.exp(-age / 0.013) - Math.exp(-age / 0.0022)) * 0.22 * pulse.pressureSkew : 0;
          pressureStep = (pressureRise - pressureTail) * (cleanProfile ? (clarityProfile ? 0.66 : 0.58) : 0.52) * Math.min(1.35, Math.max(0.55, 0.84 + edgeWeight * 0.18)) * smoothTransient * highRpmFineTrim;
        }
        const eventBodyLift = clarityProfile ? 1.24 : 1;
        const sub = Math.sin(twoPi * pulse.subHz * age + pulse.toneOffset * 0.35) * (cleanProfile ? 0.30 : 0.18) * pulse.subGain * bodyGain * eventBodyLift;
        const body = Math.sin(twoPi * pulse.bodyHz * age + pulse.toneOffset) * (cleanProfile ? 0.56 : 0.56) * bodyGain * pulse.bodyGain * eventBodyLift;
        const growl = Math.sin(twoPi * pulse.growlHz * age + pulse.toneOffset * 0.7) * (cleanProfile ? 0.24 : 0.22) * bodyGain * pulse.bodyGain * (clarityProfile ? 1.06 : 1);
        const chirpPhase = clarityProfile
          ? cleanHandoffProfile ? 0 : pulse.pipeChirp * (1 - Math.exp(-age / 0.0009)) * Math.exp(-age / 0.015) * (0.74 + pulse.pressureSkew * 0.18)
          : 0;
        const pressureDetune = clarityProfile ? cleanHandoffProfile ? 1 : 1 + Math.tanh(pressureStep * 1.8) * 0.012 * pulse.pressureSkew : 1;
        const pipePhase = twoPi * pulse.pipeHz * age * pressureDetune + chirpPhase;
        const pipe = cleanProfile
          ? pipeEnv * (
            Math.sin(pipePhase + pulse.toneOffset * 1.3) * (clarityProfile ? cleanHandoffProfile ? 0.072 : 0.092 : 0.09) +
            Math.sin(pipePhase * 1.41 + pulse.toneOffset * 0.31 - chirpPhase * 0.34) * (clarityProfile ? cleanHandoffProfile ? 0.028 * highRpmFineTrim : 0.068 : 0.065) +
            Math.sin(pipePhase * 2.03 + pulse.toneOffset * 1.7 + chirpPhase * 0.21) * (clarityProfile ? cleanHandoffProfile ? 0.010 * highRpmFineTrim : 0.042 : 0.04)
          ) * pipeGain * pulse.pipeGain
          : Math.sin(twoPi * pulse.pipeHz * age) * pipeEnv * 0.22;
        const blowdownEnv = clarityProfile
          ? transientDetail
            ? (Math.exp(-age / 0.0034) - Math.exp(-age / 0.00022)) * Math.min(1.24, Math.max(0.68, 0.72 + this.load * 0.34 + edgeWeight * 0.16))
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
          pulse.radiationNoise = (pulse.radiationNoise || 0) * (staticCleanProfile ? 0.70 : airwashControlProfile ? 0.52 : 0.18) + (this.random() - 0.5) * (staticCleanProfile ? 0 : airwashControlProfile ? 0.18 : 0.82);
          pulse.radiationNoiseLow = (pulse.radiationNoiseLow || 0) * (airwashControlProfile ? 0.92 : 0.82) + pulse.radiationNoise * (airwashControlProfile ? 0.08 : 0.18);
          const radiatedNoise = staticCleanProfile ? 0 : pulse.radiationNoise - pulse.radiationNoiseLow * 0.36;
          const radiationEnv = (Math.exp(-age / (staticCleanProfile ? 0.0015 : airwashControlProfile ? 0.0022 : 0.0054)) - Math.exp(-age / 0.00024)) * Math.min(1.24, Math.max(0.66, 0.70 + this.load * 0.36 + edgeWeight * 0.16));
          const pressureRadiance = Math.min(1, Math.abs(pressureStep) * 1.8 + Math.abs(blowdownBark) * 4.8);
          const directivityFlutter = cleanHandoffProfile ? 0 :
            Math.sin(twoPi * pulse.presenceHz * 0.42 * age + pulse.radiationPhase) * (staticCleanProfile ? 0.045 : airwashControlProfile ? 0.12 : 0.28) +
            Math.sin(twoPi * pulse.pipeHz * 2.70 * age + pulse.radiationPhase * 0.47) * (staticCleanProfile ? 0.025 : airwashControlProfile ? 0.08 : 0.16);
          exhaustRadiation = (radiatedNoise * (airwashControlProfile ? 0.22 : 0.76) + directivityFlutter * ((cleanHandoffProfile ? 0 : staticCleanProfile ? 0.045 : airwashControlProfile ? 0.16 : 0.28) + pressureRadiance * (cleanHandoffProfile ? 0 : staticCleanProfile ? 0.035 : airwashControlProfile ? 0.16 : 0.24))) *
            radiationEnv *
            pulse.radiationGain *
            eventEdgeGain *
            smoothTransient;
        }
        const dryPresence = cleanProfile
          ? (clarityProfile && !transientDetail) ? 0 : presenceEnv * pulse.presenceGain * (
            Math.sin(twoPi * pulse.presenceHz * age + pulse.toneOffset * 1.9) * (clarityProfile ? 0.018 * highRpmPresenceTrim : 0.014) +
            Math.sin(twoPi * pulse.presenceHz * 1.57 * age + pulse.toneOffset * 0.4) * (clarityProfile ? 0.022 * highRpmFineTrim : 0.007) +
            Math.sin(twoPi * pulse.presenceHz * 2.11 * age + pulse.toneOffset * 2.2) * (clarityProfile ? 0.016 * highRpmFineTrim : 0.004) +
            (clarityProfile && !cleanHandoffProfile ? Math.sin(twoPi * pulse.scatterHzA * age + pulse.scatterPhaseA) * (airwashControlProfile ? 0.006 : 0.024) : 0) +
            (clarityProfile && !cleanHandoffProfile ? Math.sin(twoPi * pulse.scatterHzB * age + pulse.scatterPhaseB) * (airwashControlProfile ? 0.004 : 0.018) : 0)
          ) * (cleanHandoffProfile ? 0.34 : staticCleanProfile ? 0.50 : airwashControlProfile ? 0.62 : 1)
          : 0;
        let airBurst = 0;
        if (clarityProfile && earlyDetail) {
          pulse.airNoise = (pulse.airNoise || 0) * (staticCleanProfile ? 0.78 : airwashControlProfile ? 0.66 : 0.46) + (this.random() - 0.5) * (staticCleanProfile ? 0 : airwashControlProfile ? 0.16 : 0.54);
          pulse.airNoiseLow = (pulse.airNoiseLow || 0) * (airwashControlProfile ? 0.96 : 0.92) + pulse.airNoise * (airwashControlProfile ? 0.04 : 0.08);
          const turbulentAir = staticCleanProfile ? 0 : pulse.airNoise - pulse.airNoiseLow * 0.72;
          const airEnv = (Math.exp(-age / (staticCleanProfile ? 0.0014 : airwashControlProfile ? 0.0028 : 0.010)) - Math.exp(-age / 0.00042)) * (0.62 + this.throttle * 0.38);
          airBurst = turbulentAir * airEnv * pulse.airBurstGain * eventEdgeGain * smoothTransient;
        }
        const airwashNoiseGate = airwashControlProfile
          ? staticCleanProfile
            ? cleanHandoffProfile
              ? Math.min(0.10, Math.max(0.004, Math.min(1, Math.abs(pressureStep) * 2.4 + Math.abs(blowdownBark) * 3.8) * 0.08 + this.load * 0.010))
              : Math.min(0.20, Math.max(0.010, Math.min(1, Math.abs(pressureStep) * 3.2 + Math.abs(blowdownBark) * 5.2) * 0.16 + this.load * 0.025))
            : Math.min(0.54, Math.max(0.10, 0.10 + Math.min(1, Math.abs(pressureStep) * 2.8 + Math.abs(blowdownBark) * 5.2) * 0.32 + this.load * 0.12))
          : 1;
        const rasp = clarityProfile
          ? earlyDetail ? (staticCleanProfile ? 0 : (this.random() - 0.5) * presenceEnv * pulse.crackle * (airwashControlProfile ? 0.055 : 0.220) * eventEdgeGain * smoothTransient) : 0
          : 0;
        let throatPulse = 0;
        if (clarityProfile && earlyDetail) {
          pulse.throatNoise = (pulse.throatNoise || 0) * (staticCleanProfile ? 0.72 : 0.22) + (this.random() - 0.5) * (staticCleanProfile ? 0 : 0.78);
          pulse.throatNoiseLow = (pulse.throatNoiseLow || 0) * 0.74 + pulse.throatNoise * 0.26;
          const throatTexture = staticCleanProfile ? 0 : pulse.throatNoise - pulse.throatNoiseLow * 0.42;
          const throatEnv = (Math.exp(-age / 0.0042) - Math.exp(-age / 0.00032)) * Math.min(1.24, Math.max(0.72, 0.78 + edgeWeight * 0.18 + this.load * 0.16));
          const throatFold = Math.tanh((pressureStep + chirpPhase * 0.12 + throatTexture * 0.68) * 2.7);
          throatPulse = (throatTexture * 0.70 + throatFold * 0.30) * throatEnv * pulse.throatGain * eventEdgeGain * smoothTransient * (cleanHandoffProfile ? 0.08 : staticCleanProfile ? 0.26 : airwashControlProfile ? 0.42 : 1) * highRpmFineTrim;
        }
        const crack = (!clarityProfile || earlyDetail)
          ? staticCleanProfile ? 0 : (this.random() - 0.5) * crackEnv * pulse.crackle * (cleanProfile ? (clarityProfile ? (airwashControlProfile ? 0.12 : 0.42) : 0.58) + this.throttle * (airwashControlProfile ? 0.08 : 0.32) : 1) * eventEdgeGain * smoothTransient
          : 0;
        let pipeReflection = 0;
        if (clarityProfile && transientDetail) {
          const reflectionAgeA = age - pulse.reflectionDelayA;
          const reflectionAgeB = age - pulse.reflectionDelayB;
          if (reflectionAgeA > 0) {
            const tapA = (Math.exp(-reflectionAgeA / 0.0048) - Math.exp(-reflectionAgeA / 0.00042));
            pipeReflection += tapA * pulse.reflectionGain * 0.34 * Math.sin(twoPi * pulse.pipeHz * 0.46 * reflectionAgeA + pulse.toneOffset);
          }
          if (reflectionAgeB > 0) {
            const tapB = (Math.exp(-reflectionAgeB / 0.0072) - Math.exp(-reflectionAgeB / 0.00070));
            pipeReflection -= tapB * pulse.reflectionGain * 0.22 * Math.sin(twoPi * pulse.pipeHz * 0.32 * reflectionAgeB + pulse.toneOffset * 0.4);
          }
        }
        const edge = cleanProfile
          ? (!clarityProfile || earlyDetail)
              ? (Math.exp(-age / 0.0021) - Math.exp(-age / 0.00028)) * ((clarityProfile ? (cleanHandoffProfile ? 0.035 : staticCleanProfile ? 0.070 : airwashControlProfile ? 0.105 : 0.165) : 0.12) + this.analysis.exhaustBrightness * (cleanHandoffProfile ? 0.014 : staticCleanProfile ? 0.030 : airwashControlProfile ? 0.055 : 0.10)) * eventEdgeGain * smoothTransient * highRpmFineTrim
            : 0
          : 0;
        const nonlinearBite = clarityProfile && transientDetail ? Math.tanh((pressureStep + pipeReflection + dryPresence * 0.55) * 2.4) * 0.045 * highRpmFineTrim : 0;
        const pressureCore = pressureStep + pipeReflection + nonlinearBite + dryPresence * 0.42 + airBurst * 0.58 + throatPulse * 0.74 + blowdownBark * 0.92 + exhaustRadiation * 0.80;
        const pressureDelta = clarityProfile ? pressureCore - (pulse.previousPressure || 0) : 0;
        pulse.previousPressure = pressureCore;
        const snapEnv = clarityProfile ? Math.exp(-age / 0.0048) * Math.min(1, Math.max(0, 1 - age / 0.021)) : 0;
        const pressureSnap = clarityProfile
          ? earlyDetail ? Math.tanh(pressureDelta * 7.2) *
            snapEnv *
            pulse.presenceGain *
            (cleanHandoffProfile ? 0.012 + this.analysis.exhaustBrightness * 0.006 + this.load * 0.003 : 0.027 + this.analysis.exhaustBrightness * 0.014 + this.load * 0.007) *
            eventEdgeGain *
            smoothTransient *
            (cleanHandoffProfile ? 0.22 : staticCleanProfile ? 0.40 : airwashControlProfile ? 0.62 : 1) *
            highRpmFineTrim : 0
          : 0;
        const pressureGrain = clarityProfile
          ? earlyDetail && !staticCleanProfile ? (this.random() - 0.5) *
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
        const pulsePan = Math.min(0.72, Math.max(-0.72, pulse.pan * denseStereoWidth));
        const leftGain = Math.sqrt((1 - pulsePan) * 0.5);
        const rightGain = Math.sqrt((1 + pulsePan) * 0.5);
        left += sample * leftGain;
        right += sample * rightGain;
        const maxPulseAge = clarityProfile
          ? stereoStabilityProfile && cylinderCount >= 10 ? (rpmNorm > 0.92 ? 0.066 : 0.084) : cylinderBalanceProfile && cylinderCount >= 10 ? 0.092 : cylinderCount >= 10 ? 0.070 : rpmNorm > 0.86 ? 0.082 : 0.105
          : 0.16;
        const minUsefulEnvelope = stereoStabilityProfile ? (cylinderCount >= 10 && rpmNorm > 0.92 ? 0.00070 : 0.00042) : cylinderBalanceProfile ? 0.00042 : realtimeLeanDetail ? 0.0012 : 0.0006;
        if (env < minUsefulEnvelope || age > maxPulseAge) this.pulses.splice(p, 1);
      }

      if (clarityProfile) {
        this.combustionEnvelope = (this.combustionEnvelope || 0) * Math.exp(-1 / (sr * 0.033));
        this.combustionEdgeEnvelope = (this.combustionEdgeEnvelope || 0) * Math.exp(-1 / (sr * 0.010));
        this.mechanicalTickEnvelope = (this.mechanicalTickEnvelope || 0) * Math.exp(-1 / (sr * 0.012));
      } else {
        this.combustionEnvelope = 0;
        this.combustionEdgeEnvelope = 0;
        this.mechanicalTickEnvelope = 0;
      }

      const pulseConditionedSupport = clarityProfile ? Math.min(1.04, Math.max(0.26, 0.26 + this.combustionEnvelope * 0.72)) : 1;
      const edgeConditionedSupport = clarityProfile ? Math.min(1.16, Math.max(0.50, 0.50 + this.combustionEdgeEnvelope * 0.40)) : 1;

      const cycleHz = Math.max(0.5, rpm / 120);
      this.rumblePhase += twoPi * cycleHz / sr;
      this.intakePhase += twoPi * (rpm / 60) * (this.sound.forcedType === 'na' ? 1.15 : 0.95) / sr;
      this.intakeResonancePhase = (this.intakeResonancePhase || 0) + twoPi * Math.min(2200, Math.max(110, intakeMode.frequencyHz * (0.74 + this.throttle * 0.30 + rpmNorm * (cleanHandoffProfile ? 0.04 : staticCleanProfile ? 0.08 : 0.18)))) / sr;
      this.mechPhase += twoPi * (rpm / 60) * 6 / sr;
      if (this.rumblePhase > twoPi) this.rumblePhase -= twoPi;
      if (this.intakePhase > twoPi) this.intakePhase -= twoPi;
      if (this.intakeResonancePhase > twoPi) this.intakeResonancePhase -= twoPi;
      if (this.mechPhase > twoPi) this.mechPhase -= twoPi;

      const idleLope = rpm < 1300 ? Math.sin(this.rumblePhase * 1.35) * this.analysis.idleInstability * (1 - rpmNorm) : 0;
      const cylinderRoughness = cleanProfile ? Math.min(1.35, Math.max(0.62, 1.20 - (acoustic.pulseDensitySmoothing || 1) * 0.16 + (acoustic.bankRoughness || 0) * 0.18)) : 1;
      const lowOrderDrive = cleanProfile
        ? Math.min(1.95, Math.max(0.35, (0.64 + (acoustic.lowOrderEnergy || 0) * 0.62 + (acoustic.bankRoughness || 0) * 0.34) * lowOrderGain * bassShelf * bodyResonanceGain))
        : 1;
      const rumbleCarrier =
        Math.sin(this.rumblePhase * 2 + 0.18) * 0.48 +
        Math.sin(this.rumblePhase * 3 + 1.1) * 0.30 +
        Math.sin(this.rumblePhase * 4 + 0.43) * 0.22;
      const rumble = rumbleCarrier * (0.0045 + this.load * 0.010) * cylinderRoughness * lowOrderDrive * (1 + idleLope * 5);
      const denseSmooth = cleanProfile ? Math.min(0.85, Math.max(0, ((acoustic.pulseDensitySmoothing || 1) - 1) * (cylinderCount / 8))) : 0;
      const densityBed = denseSmooth > 0
        ? (
          Math.sin(this.rumblePhase * cylinderCount + 0.41) * 0.55 +
          Math.sin(this.rumblePhase * cylinderCount * 1.5 + 1.2) * 0.25
        ) * (0.002 + this.load * 0.006) * denseSmooth * Math.min(1.16, Math.max(0.72, 1.14 - (acoustic.bankRoughness || 0) * 0.22)) * (clarityProfile ? (cylinderBalanceProfile ? 0.34 : 0.22) * pulseConditionedSupport : 1)
        : 0;
      if (cleanProfile) {
        const intakeNoiseInput = this.random() - 0.5;
        this.intakeNoise = accessoryQualityProfile
          ? this.intakeNoise * (staticCleanProfile ? 0.985 : airwashControlProfile ? 0.94 : 0.82) + intakeNoiseInput * (staticCleanProfile ? 0 : airwashControlProfile ? 0.06 : 0.18)
          : this.intakeNoise * 0.94 + intakeNoiseInput * 0.06;
        this.intakeNoiseLow = accessoryQualityProfile
          ? (this.intakeNoiseLow || 0) * (staticCleanProfile ? 0.998 : airwashControlProfile ? 0.996 : 0.988) + this.intakeNoise * (staticCleanProfile ? 0.002 : airwashControlProfile ? 0.004 : 0.012)
          : (this.intakeNoiseLow || 0) * 0.94 + this.intakeNoise * 0.06;
      } else {
        this.intakeNoise = this.intakeNoise * 0.985 + (this.random() - 0.5) * 0.03;
        this.intakeNoiseLow = (this.intakeNoiseLow || 0) * 0.985 + this.intakeNoise * 0.015;
      }
      const intakePulse = Math.max(0, Math.sin(this.intakePhase + idleLope * 5));
      const intakeCharacterLift = cylinderBalanceProfile ? Math.min(1.75, Math.max(0.85, 0.72 + this.analysis.intakeGain * 1.80)) : 1;
      const inductionWorkGate = accessoryQualityProfile
        ? Math.min(0.88, Math.max(0.05, 0.045 + this.combustionEnvelope * 0.34 + Math.pow(Math.max(0, this.throttle * this.load), 0.88) * 0.42 + intakePulse * 0.07))
        : 1;
      const inductionBodyMakeup = airwashControlProfile ? Math.min(1.18, Math.max(1.08, 1.08 + this.load * 0.10)) : accessoryQualityProfile ? Math.min(1.12, Math.max(1.04, 1.04 + this.load * 0.08)) : 1;
      const intakeTextureNoise = staticCleanProfile ? 0 : accessoryQualityProfile ? this.intakeNoise - (this.intakeNoiseLow || 0) * (airwashControlProfile ? 0.92 : 0.82) : this.intakeNoise;
      const intakeRpmGain = cleanHandoffProfile ? (0.032 + Math.pow(rpmNorm, 0.50) * 0.035) : staticCleanProfile ? (0.06 + Math.pow(rpmNorm, 0.50) * 0.070) : airwashControlProfile ? (0.08 + Math.pow(rpmNorm, 0.55) * 0.10) : accessoryQualityProfile ? (0.10 + Math.pow(rpmNorm, 0.68) * 0.18) : (0.18 + rpmNorm * 0.34);
      const intakeResonance = cleanProfile
        ? (
          Math.sin(this.intakeResonancePhase + idleLope * 2.5) * 0.62 +
          Math.sin(this.intakeResonancePhase * 1.48 + 0.7) * 0.24
        ) * this.analysis.intakeGain * Math.pow(this.throttle, 1.25) * (0.020 + rpmNorm * (cleanHandoffProfile ? 0.0015 : staticCleanProfile ? 0.004 : airwashControlProfile ? 0.010 : accessoryQualityProfile ? 0.024 : 0.042)) * intakeCharacterLift * Math.min(1.65, Math.max(0.45, intakeTexture * clarity / Math.max(0.82, muffling))) * inductionWorkGate
        : 0;
      const intake = cleanProfile
        ? (intakeTextureNoise * (staticCleanProfile ? 0 : airwashControlProfile ? 0.010 : accessoryQualityProfile ? 0.040 : 0.18) + intakePulse * (cleanHandoffProfile ? 0.045 : staticCleanProfile ? 0.085 : airwashControlProfile ? 0.10 : accessoryQualityProfile ? 0.13 : 0.11)) *
          this.analysis.intakeGain *
          Math.pow(this.throttle, 1.65) *
          intakeRpmGain *
          Math.min(1.65, Math.max(0.45, intakeTexture * clarity / Math.max(0.82, muffling))) *
          (cylinderBalanceProfile ? 1.08 : 1) *
          inductionWorkGate +
          intakeResonance
        : (this.intakeNoise * 0.7 + intakePulse * 0.08) * this.analysis.intakeGain * Math.pow(this.throttle, 1.45) * (0.16 + rpmNorm * 0.25);
      const valveCarrier = Math.sin(this.mechPhase);
      const mechTick = Math.pow(Math.max(0, valveCarrier), 18) * (0.0015 + rpmNorm * 0.0045);
      let valvetrain = 0;
      if (cleanProfile) {
        if (clarityProfile) {
          this.mechanicalNoise = (this.mechanicalNoise || 0) * (staticCleanProfile ? 0.86 : 0.42) + (this.random() - 0.5) * (staticCleanProfile ? 0 : 0.58);
          this.mechanicalNoiseLow = (this.mechanicalNoiseLow || 0) * 0.88 + this.mechanicalNoise * 0.12;
          const mechanicalTexture = staticCleanProfile ? 0 : this.mechanicalNoise - this.mechanicalNoiseLow * 0.68;
          const mechanicalEnvelope = Math.min(1.55, Math.max(0, (this.mechanicalTickEnvelope || 0) * edgeConditionedSupport));
          const subduedValveTone = valveCarrier * (0.00028 + rpmNorm * 0.00076) * Math.min(0.92, Math.max(0.64, 0.92 - this.combustionEnvelope * 0.16));
          const eventClick = mechTick * mechanicalEnvelope * (staticCleanProfile ? 0.52 : 0.42);
          const dryTick = mechanicalTexture * mechanicalEnvelope * (0.0038 + rpmNorm * 0.0074) * (0.72 + this.load * 0.32);
          valvetrain = subduedValveTone + eventClick + dryTick;
        } else {
          valvetrain = valveCarrier * (0.0014 + rpmNorm * 0.0026) + mechTick;
        }
      } else {
        valvetrain = valveCarrier * (0.002 + rpmNorm * 0.004) + (this.random() - 0.5) * (0.007 + rpmNorm * 0.010);
      }
      const flatPlaneHighOrder = this.sound.crankshaft === 'flat-plane' ? 1.35 : 0.85;
      const highOrderRpm = cleanProfile ? Math.pow(rpmNorm, 1.4) : 1;
      const orderDrive = Math.pow(this.throttle, 1.25) * (0.28 + this.load * 0.72);
      let orderTone = 0;
      if (cleanProfile) {
        const orderSpectrum = acoustic.orderSpectrum || [];
        const familyPreset = acoustic.familyPreset || { highOrderGain: 1 };
        const tiltDarkening = Math.min(1.24, Math.max(0.62, 1.08 - (spectralTilt * (acoustic.spectralTilt || 1) - 1) * 0.22));
        for (let orderIndex = 0; orderIndex < orderSpectrum.length; orderIndex++) {
          const bin = orderSpectrum[orderIndex];
          const frequency = cycleHz * bin.cycleOrder;
          if (frequency < 32 || frequency > 2600) continue;
          const lowBias = bin.cycleOrder <= 6 ? lowOrderDrive : 1;
          const highBias = bin.cycleOrder >= cylinderCount
            ? flatPlaneHighOrder * highOrderRpm * (familyPreset.highOrderGain || 1) * tiltDarkening
            : 1;
          const bandGain = bin.cycleOrder <= 8
            ? (bin.bankDifference || 0) * 0.0068 + (bin.wholeEngineGain || 0) * 0.0042
            : (bin.bankDifference || 0) * 0.0032 + (bin.wholeEngineGain || 0) * 0.0038;
          orderTone += Math.sin(this.rumblePhase * bin.cycleOrder + (bin.phaseRad || 0)) * bandGain * lowBias * highBias;
        }
        orderTone *= orderDrive * Math.min(1.65, Math.max(0.40, orderWeight * clarity)) * (clarityProfile ? Math.min(0.78, Math.max(0.42, 0.48 + this.combustionEnvelope * 0.20)) : 1);
      }

      const clarityIntakeTrim = clarityProfile ? cleanHandoffProfile ? Math.min(0.48, Math.max(0.34, 0.36 + intakePulse * 0.08 + this.throttle * 0.04)) : Math.min(0.94, Math.max(0.68, 0.70 + intakePulse * 0.18 + this.throttle * 0.08)) : 1;
      const clarityValvetrainTrim = clarityProfile ? Math.min(0.95, Math.max(0.72, 0.74 + edgeConditionedSupport * 0.18)) : 1;
      left += rumble * inductionBodyMakeup + densityBed * 0.94 + intake * (accessoryQualityProfile ? 0.74 : 0.82) * clarityIntakeTrim + valvetrain * clarityValvetrainTrim + orderTone * 0.96;
      right += rumble * inductionBodyMakeup + densityBed * 1.06 + intake * (accessoryQualityProfile ? 0.92 : 1.05) * clarityIntakeTrim + valvetrain * 0.9 * clarityValvetrainTrim + orderTone * 1.04;

      if (this.sound.forcedType === 'turbo') {
        const sizeLag = this.sound.turboSize === 'small' ? 0.7 : this.sound.turboSize === 'large' ? 1.35 : 1;
        const spoolRange = (accessoryQualityProfile ? 1700 : 2600) * sizeLag;
        const aboveThreshold = Math.max(0, rpm - this.sound.turboSpoolThreshold);
        const earlySpoolLift = accessoryQualityProfile && aboveThreshold > 0
          ? Math.min(0.28, 0.12 + aboveThreshold / 10000)
          : 0;
        const targetSpool = Math.min(1, Math.max(0, (aboveThreshold / spoolRange) * this.throttle * (accessoryQualityProfile ? 0.88 + this.load * 0.40 : 0.76 + this.load * 0.34) + earlySpoolLift * this.throttle));
        if (accessoryQualityProfile) {
          const spoolResponseSec = this.sound.turboSize === 'small' ? 0.070 : this.sound.turboSize === 'large' ? 0.240 : 0.135;
          this.turboSpool = (this.turboSpool || 0) + (targetSpool - (this.turboSpool || 0)) * (1 - Math.exp(-1 / (sr * spoolResponseSec)));
        } else {
          this.turboSpool = targetSpool;
        }
        const spool = Math.min(1, Math.max(0, accessoryQualityProfile ? (this.turboSpool || 0) : targetSpool));
        const shaftTone = accessoryQualityProfile ? Math.pow(spool, 0.58) * (0.82 + rpmNorm * 0.18) : spool;
        const turboHz = accessoryQualityProfile
          ? Math.min(9800, Math.max(1900, 2200 + shaftTone * (this.sound.turboSize === 'large' ? 4400 : this.sound.turboSize === 'small' ? 6100 : 5200) + rpmNorm * 320))
          : cleanProfile ? 1800 + spool * 5400 + rpmNorm * 700 : 1700 + spool * 6500 + rpmNorm * 900;
        this.boostPhase += twoPi * turboHz / sr;
        if (this.boostPhase > twoPi) this.boostPhase -= twoPi;
        const whistle = accessoryQualityProfile
          ? Math.sin(this.boostPhase) * 0.50 + Math.sin(this.boostPhase * 1.618 + (this.turboFlutterPhase || 0) * 0.2) * 0.14
          : Math.sin(this.boostPhase) + Math.sin(this.boostPhase * 1.49) * (cleanProfile ? 0.12 : 0.28);
        if (cleanProfile) {
          this.turboFlutterPhase = (this.turboFlutterPhase || 0) + twoPi * (accessoryQualityProfile ? 28 + spool * 92 + rpmNorm * 26 : 34 + spool * 130 + rpmNorm * 80) / sr;
          if (this.turboFlutterPhase > twoPi) this.turboFlutterPhase -= twoPi;
          const gatedFlow = spool * this.throttle * Math.min(1.75, Math.max(0.45, turboWhoosh));
          this.turboWhooshFast = (this.turboWhooshFast || 0) * (cleanHandoffProfile ? 0.94 : accessoryQualityProfile ? 0.64 : 0.72) + (this.random() - 0.5) * (cleanHandoffProfile ? 0 : accessoryQualityProfile ? 0.36 : 0.28);
          this.turboWhooshSlow = (this.turboWhooshSlow || 0) * (cleanHandoffProfile ? 0.992 : accessoryQualityProfile ? 0.975 : 0.985) + this.turboWhooshFast * (cleanHandoffProfile ? 0.008 : accessoryQualityProfile ? 0.025 : 0.015);
          const compressorTexture = cleanHandoffProfile ? 0 : this.turboWhooshFast - this.turboWhooshSlow * (accessoryQualityProfile ? 0.62 : 0.55);
          const surgeWindow = accessoryQualityProfile ? Math.min(1, Math.max(0, (1 - Math.abs(spool - 0.58) * 1.25) * (0.34 + this.load * 0.66) * this.throttle)) : 0;
          const compressorBreath = Math.sin(this.turboFlutterPhase) * gatedFlow * (cleanHandoffProfile ? 0.0008 + surgeWindow * 0.0022 + rpmNorm * 0.0007 : accessoryQualityProfile ? 0.0025 + surgeWindow * 0.006 + rpmNorm * 0.0018 : 0.002 + rpmNorm * 0.004);
          const flowNoise = compressorTexture *
            gatedFlow *
            (cleanHandoffProfile ? 0 : accessoryQualityProfile ? 0.010 + surgeWindow * 0.012 + this.sound.maxBoost / 3600 : 0.010 + this.sound.maxBoost / 3200);
          const wastegate = this.sound.wastegateEnabled && this.load > 0.55 && spool > 0.65
            ? (accessoryQualityProfile ? Math.sin(this.turboFlutterPhase * 1.7) + compressorTexture * (cleanHandoffProfile ? 0 : 0.45) : Math.sin(this.boostPhase * 0.37)) * spool * (cleanHandoffProfile ? 0.0016 : accessoryQualityProfile ? 0.0045 : 0.006) * Math.min(1.5, Math.max(0.5, turboWhoosh))
            : 0;
          const turbo = whistle * spool * this.throttle * (accessoryQualityProfile ? 0.004 + this.sound.maxBoost / 5200 : 0.005 + this.sound.maxBoost / 3000) * Math.min(1.45, Math.max(0.45, turboTone)) +
            flowNoise +
            compressorBreath +
            wastegate;
          left += turbo * (accessoryQualityProfile ? 0.94 : 0.88);
          right += turbo;
        } else {
          const turbo = whistle * spool * (0.018 + this.sound.maxBoost / 900);
          left += turbo * 0.86;
          right += turbo;
        }
      } else if (this.sound.forcedType === 'supercharged') {
        const type = this.sound.superchargerType || 'roots';
        const driveRatio = type === 'centrifugal' ? 5.1 : type === 'twin-screw' ? 3.45 : 2.85;
        const rotorHz = (rpm / 60) * driveRatio;
        const superchargerWake = accessoryQualityProfile ? Math.min(1, Math.max(0, (rpm - 900) / 850)) : 1;
        const scHz = accessoryQualityProfile
          ? Math.min(6800, Math.max(260, rotorHz * (type === 'centrifugal' ? 12.5 : type === 'twin-screw' ? 9.5 : 7.5)))
          : (rpm / 60) * driveRatio * (cleanProfile ? (type === 'roots' ? 9 : 11) : 12);
        this.boostPhase += twoPi * scHz / sr;
        this.superchargerGearPhase = (this.superchargerGearPhase || 0) + twoPi * Math.min(7600, Math.max(220, rotorHz * (type === 'twin-screw' ? 10.5 : type === 'roots' ? 8.2 : 13.5))) / sr;
        this.superchargerLobePhase = (this.superchargerLobePhase || 0) + twoPi * Math.min(5200, Math.max(90, rotorHz * (type === 'roots' ? 6 : type === 'twin-screw' ? 8 : 11))) / sr;
        if (this.boostPhase > twoPi) this.boostPhase -= twoPi;
        if (this.superchargerGearPhase > twoPi) this.superchargerGearPhase -= twoPi;
        if (this.superchargerLobePhase > twoPi) this.superchargerLobePhase -= twoPi;
        if (cleanProfile) {
          const typeGain = type === 'roots' ? 1.07 : type === 'twin-screw' ? 1.55 : 0.92;
          const bypassGate = accessoryQualityProfile ? Math.min(1.08, Math.max(0.32, 0.32 + this.throttle * 0.50 + this.load * 0.28)) : 1;
          const whine = accessoryQualityProfile
            ? Math.sin(this.superchargerGearPhase) * 0.62 +
              Math.sin(this.superchargerGearPhase * 2.01 + 0.3) * 0.18 +
              Math.sin(this.boostPhase * 0.74 + 0.8) * 0.16
            : Math.sin(this.boostPhase) + Math.sin(this.boostPhase * 2) * 0.10;
          this.superchargerNoise = accessoryQualityProfile
            ? (this.superchargerNoise || 0) * (cleanHandoffProfile ? 0.98 : 0.90) + (this.random() - 0.5) * (cleanHandoffProfile ? 0 : 0.10)
            : this.superchargerNoise;
          const lobePulse = type === 'centrifugal'
            ? 0
            : Math.pow(Math.max(0, Math.sin(this.superchargerLobePhase)), type === 'roots' ? 2.4 : 2.4) * (accessoryQualityProfile ? (type === 'twin-screw' ? 0.024 + this.load * 0.036 : 0.010 + this.load * 0.018) : 0.006 + this.load * 0.010);
          const compressorAir = accessoryQualityProfile
            ? (this.superchargerNoise || 0) * (cleanHandoffProfile ? 0 : type === 'centrifugal' ? 0.014 : type === 'twin-screw' ? 0.018 : 0.007) * bypassGate * (0.45 + rpmNorm * 0.55)
            : 0;
          const centrifugalSiren = accessoryQualityProfile && type === 'centrifugal'
            ? (Math.sin(this.boostPhase) * 0.54 + Math.sin(this.boostPhase * 1.37) * 0.16) * Math.pow(rpmNorm, 1.35) * (0.010 + this.load * 0.014)
            : 0;
          const twinScrewCompression = accessoryQualityProfile && type === 'twin-screw'
            ? Math.tanh(whine * 1.9 + (this.superchargerNoise || 0) * (cleanHandoffProfile ? 0 : 1.1)) * (cleanHandoffProfile ? 0.020 + this.load * 0.018 : 0.030 + this.load * 0.030) * bypassGate
            : 0;
          const superchargerOutputLift = accessoryQualityProfile && type === 'twin-screw' ? 1.16 : 1;
          const gain = this.sound.whineIntensity *
            typeGain *
            (accessoryQualityProfile ? 0.034 + Math.pow(Math.max(0, rpmNorm), 0.72) * 0.072 : 0.008 + rpmNorm * 0.038) *
            Math.min(1.75, Math.max(0.45, superchargerWhine)) *
            bypassGate;
          const supercharger = (whine * gain +
            lobePulse * this.sound.whineIntensity * Math.min(1.55, Math.max(0.55, superchargerWhine)) +
            compressorAir +
            twinScrewCompression * this.sound.whineIntensity * Math.min(1.55, Math.max(0.55, superchargerWhine)) +
            centrifugalSiren * this.sound.whineIntensity * Math.min(1.55, Math.max(0.55, superchargerWhine))) * superchargerOutputLift * superchargerWake;
          left += supercharger * (accessoryQualityProfile ? 0.96 : 0.92);
          right += supercharger;
        } else {
          const whine = Math.sin(this.boostPhase) + Math.sin(this.boostPhase * 2) * 0.22;
          const gain = this.sound.whineIntensity * (0.012 + rpmNorm * 0.055);
          left += whine * gain * 0.92;
          right += whine * gain;
        }
      }

      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        left = 0;
        right = 0;
        this.previousLeftInput = 0;
        this.previousRightInput = 0;
        this.previousLeftOutput = 0;
        this.previousRightOutput = 0;
      }

      const dcCoefficient = clarityProfile ? 0.9992 : 0.995;
      let dcLeft = left - this.previousLeftInput + dcCoefficient * this.previousLeftOutput;
      let dcRight = right - this.previousRightInput + dcCoefficient * this.previousRightOutput;
      if (!Number.isFinite(dcLeft) || !Number.isFinite(dcRight)) {
        dcLeft = 0;
        dcRight = 0;
        this.previousLeftInput = 0;
        this.previousRightInput = 0;
        this.previousLeftOutput = 0;
        this.previousRightOutput = 0;
      } else {
        this.previousLeftInput = left;
        this.previousRightInput = right;
        this.previousLeftOutput = Math.min(1.8, Math.max(-1.8, dcLeft));
        this.previousRightOutput = Math.min(1.8, Math.max(-1.8, dcRight));
      }

      if (stereoStabilityProfile && cylinderCount >= 10) {
        const denseOutputWidth = Math.min(0.50, Math.max(0.18, 0.50 - Math.max(0, cylinderCount - 8) * 0.055 - Math.max(0, rpmNorm - 0.65) * 0.22));
        const mid = (dcLeft + dcRight) * 0.5;
        const side = (dcLeft - dcRight) * 0.5 * denseOutputWidth;
        dcLeft = mid + side;
        dcRight = mid - side;
      }

      const cylinderOutputMakeup = cylinderBalanceProfile
        ? Math.min(cleanHandoffProfile ? 1.84 : 1.68, Math.max(1, 1 + Math.max(0, cylinderCount - 8) * (cleanHandoffProfile ? 0.240 : 0.180) + Math.max(0, (acoustic.pulseDensitySmoothing || 1) - 1) * (cleanHandoffProfile ? 0.160 : 0.120)))
        : 1;
      const tuningOutputGain = cleanProfile ? Math.min(1.14, Math.max(0.84, 1 + (clarity - muffling) * (clarityProfile ? 0.11 : 0.08))) : 1;
      const outputDrive = clarityProfile ? (cylinderBalanceProfile ? 1.04 : 1.02) : 1.18;
      const outputGain = (clarityProfile ? 0.96 : 0.88) * cylinderOutputMakeup;
      if (clarityProfile) {
        const drivenLeft = dcLeft * outputDrive * tuningOutputGain;
        const drivenRight = dcRight * outputDrive * tuningOutputGain;
        const clearLeft = shapeClarityOutput(drivenLeft);
        const clearRight = shapeClarityOutput(drivenRight);
        const outLeft = Math.min(1, Math.max(-1, clearLeft * outputGain));
        const outRight = Math.min(1, Math.max(-1, clearRight * outputGain));
        leftChannel[i] = Number.isFinite(outLeft) ? outLeft : 0;
        rightChannel[i] = Number.isFinite(outRight) ? outRight : 0;
      } else {
        const outLeft = Math.tanh(dcLeft * outputDrive * tuningOutputGain) * outputGain;
        const outRight = Math.tanh(dcRight * outputDrive * tuningOutputGain) * outputGain;
        leftChannel[i] = Number.isFinite(outLeft) ? outLeft : 0;
        rightChannel[i] = Number.isFinite(outRight) ? outRight : 0;
      }
    }

    return true;
  }
}

registerProcessor('combustion-processor', CombustionProcessor);
`;

export const AUDIO_ENGINE_MODEL_VERSION = "ess-audio-v16-physical-core";

export class AudioEngine {
  readonly modelVersion = AUDIO_ENGINE_MODEL_VERSION;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiterGain: GainNode | null = null;
  private combustionNode: AudioWorkletNode | null = null;
  private exhaustFilter: BiquadFilterNode | null = null;
  private intakeFilter: BiquadFilterNode | null = null;
  private exhaustMixGain: GainNode | null = null;
  private intakeMixGain: GainNode | null = null;
  private dryExhaustGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private superchargerOsc: OscillatorNode | null = null;
  private superchargerGain: GainNode | null = null;
  private fallbackOsc: OscillatorNode | null = null;
  private fallbackGain: GainNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private animationFrame: number | null = null;
  private workletReady = false;
  private isInitialized = false;
  private revLimiterActive = false;
  private revLimiterCooldown = 0;
  private analyserBuffer: Uint8Array<ArrayBuffer> | null = null;
  private silentFrameCount = 0;
  private rebuildInProgress = false;

  // ---- v16 physical core
  private essNode: AudioWorkletNode | null = null;
  private essReady = false;
  private driveMode: DriveMode = "free";
  /** v16 vehicle mode options (auto-shift, launch control, brake, exhaust valve override). */
  private vehicleOptions: { autoShift: boolean; launchControl: boolean; brake: number; exhaustValve?: "auto" | "open" | "closed" } = { autoShift: true, launchControl: false, brake: 0 };
  private perspective: ListenerPerspective = "exterior-rear";
  private stemGains: Partial<StemGains> = {};
  private telemetry: EngineTelemetry | null = null;
  private engineInfo: { firingOrder: number[]; intervals: number[]; notes: string[]; displacementL: number; internalRate?: number } | null = null;

  private config: EngineConfiguration = DEFAULT_ENGINE_CONFIG;
  private state: PlaybackState = {
    isPlaying: false,
    rpm: 850,
    throttle: 0,
    load: 0.2,
    targetRpm: 850,
    boost: 0,
  };

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio is not available in this browser. Try Chrome, Edge, or a mobile browser with audio support enabled.");
    }

    this.ctx = new AudioContextCtor({ sampleRate: 48000, latencyHint: "interactive" });
    const blob = new Blob([COMBUSTION_PROCESSOR_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);

    try {
      await this.ctx.audioWorklet.addModule(url);
      this.workletReady = true;
    } catch (error) {
      console.warn("AudioWorklet not supported, falling back to oscillator synthesis", error);
      this.workletReady = false;
    } finally {
      URL.revokeObjectURL(url);
    }
    try {
      await this.ctx.audioWorklet.addModule(essProcessorUrl);
      this.essReady = true;
    } catch (error) {
      console.warn("v16 physical core unavailable; using the legacy model", error);
      this.essReady = false;
    }

    this.setupAudioGraph();
    this.isInitialized = true;
  }

  private setupAudioGraph(): void {
    if (!this.ctx) return;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -7;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 2.4;
    this.compressor.attack.value = 0.0012;
    this.compressor.release.value = 0.09;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = resolveLiveOutputGain(this.config);

    this.limiterGain = this.ctx.createGain();
    this.limiterGain.gain.value = 1;

    this.exhaustFilter = this.ctx.createBiquadFilter();
    this.exhaustFilter.type = "lowpass";
    this.exhaustFilter.frequency.value = 5600;
    this.exhaustFilter.Q.value = 0.55;

    this.intakeFilter = this.ctx.createBiquadFilter();
    this.intakeFilter.type = "bandpass";
    this.intakeFilter.frequency.value = 900;
    this.intakeFilter.Q.value = 0.82;

    this.turboOsc = this.ctx.createOscillator();
    this.turboOsc.type = "sine";
    this.turboOsc.frequency.value = 0;
    this.turboGain = this.ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboOsc.start();

    this.superchargerOsc = this.ctx.createOscillator();
    this.superchargerOsc.type = "sawtooth";
    this.superchargerOsc.frequency.value = 0;
    this.superchargerGain = this.ctx.createGain();
    this.superchargerGain.gain.value = 0;
    this.superchargerOsc.connect(this.superchargerGain);
    this.superchargerOsc.start();

    this.destinationNode = this.ctx.createMediaStreamDestination();
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.78;

    this.masterGain.connect(this.limiterGain);
    this.limiterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
    this.compressor.connect(this.destinationNode);
    this.compressor.connect(this.analyserNode);
    this.turboGain.connect(this.masterGain);
    this.superchargerGain.connect(this.masterGain);
  }

  private usesPhysicalCore(config: EngineConfiguration = this.config): boolean {
    return this.essReady && isPhysicalSoundProfile(config.soundProfile);
  }

  setConfig(config: EngineConfiguration): void {
    const nextConfig = { ...config, soundProfile: normalizeSoundProfile(config.soundProfile), seed: config.seed ?? 42 };
    if (config.listener?.perspective) this.perspective = config.listener.perspective;
    if (this.usesPhysicalCore(nextConfig)) {
      const wasPhysical = this.usesPhysicalCore();
      this.config = nextConfig;
      if (!wasPhysical) this.teardownLegacyNodes();
      this.masterGain?.gain.setTargetAtTime(1, this.ctx?.currentTime ?? 0, 0.05);
      if (this.state.isPlaying) {
        this.ensureEssNode();
        this.essNode?.port.postMessage({ type: "config", config: nextConfig, perspective: this.perspective });
      }
      return;
    }
    if (this.essNode) {
      this.essNode.disconnect();
      this.essNode = null;
    }
    const requiresProcessorSwap = this.state.isPlaying &&
      this.workletReady &&
      !!this.combustionNode &&
      this.structuralAudioKey(this.config) !== this.structuralAudioKey(nextConfig);

    this.config = nextConfig;
    this.state.rpm = Math.max(600, Math.min(this.state.rpm || 850, this.config.quick.redline));
    this.state.targetRpm = Math.max(600, Math.min(this.state.targetRpm || this.state.rpm, this.config.quick.redline));
    this.revLimiterActive = false;
    this.revLimiterCooldown = 0;
    this.silentFrameCount = 0;

    if (requiresProcessorSwap) {
      this.rebuildForConfigChange();
    } else {
      this.updateAudioParameters();
      this.combustionNode?.port.postMessage({ reset: true, rpm: this.state.rpm, throttle: this.state.throttle, load: this.state.load });
    }
  }

  private structuralAudioKey(config: EngineConfiguration): string {
    return JSON.stringify({
      soundProfile: normalizeSoundProfile(config.soundProfile),
      cylinderCount: config.quick.cylinderCount,
      layout: config.quick.layout,
      displacement: config.quick.displacement,
      crankshaft: config.quick.crankshaft,
      exhaustCharacter: config.quick.exhaustCharacter,
      redline: config.quick.redline,
      aspiration: config.quick.aspiration,
      firingOrder: config.advanced?.firingOrder ?? null,
      exhaustRouting: config.advanced?.exhaustRouting ?? null,
      headerGeometry: config.advanced?.headerGeometry ?? null,
      intakeType: config.advanced?.intakeType ?? null,
      turboSize: config.forcedInduction.turboSize ?? null,
      turboSpoolThreshold: config.forcedInduction.turboSpoolThreshold ?? null,
      maxBoost: config.forcedInduction.maxBoost ?? null,
      superchargerType: config.forcedInduction.superchargerType ?? null,
    });
  }

  private resetAccessoryRamps(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.turboGain?.gain.cancelScheduledValues(now);
    this.superchargerGain?.gain.cancelScheduledValues(now);
    this.turboGain?.gain.setValueAtTime(0, now);
    this.superchargerGain?.gain.setValueAtTime(0, now);
    this.state.boost = 0;
  }

  private rebuildForConfigChange(): void {
    if (this.rebuildInProgress || !this.ctx || !this.workletReady) {
      this.updateAudioParameters();
      return;
    }

    this.rebuildInProgress = true;
    try {
      this.resetAccessoryRamps();
      this.combustionNode?.port.postMessage({ reset: true });
      this.combustionNode?.disconnect();
      this.combustionNode = null;
      const nextNode = this.createCombustionNode();
      nextNode?.port.postMessage({
        reset: true,
        rpm: this.state.rpm,
        throttle: this.state.throttle,
        load: this.state.load,
      });
    } finally {
      this.rebuildInProgress = false;
    }
  }

  private updateAudioParameters(): void {
    if (!this.ctx || !this.config) return;

    const { quick, advanced, forcedInduction } = this.config;
    const soundProfile = normalizeSoundProfile(this.config.soundProfile);
    const cleanProfile = !isBaselineSoundProfile(soundProfile);
    const clarityProfile = isClaritySoundProfile(soundProfile);
    const analysis = buildEngineSoundAnalysis(this.config);
    const tuning = resolveSoundTuningWeights(this.config);
    const realtimeMix = resolveRealtimeAudioMixProfile(soundProfile);
    const liveOutputGain = resolveLiveOutputGain(this.config);

    this.masterGain?.gain.setTargetAtTime(liveOutputGain, this.ctx.currentTime, 0.06);
    if (!this.revLimiterActive) {
      this.limiterGain?.gain.setTargetAtTime(1, this.ctx.currentTime, 0.04);
    }

    if (this.compressor) {
      this.compressor.threshold.setTargetAtTime(realtimeMix.compressorThresholdDb, this.ctx.currentTime, 0.05);
      this.compressor.knee.setTargetAtTime(realtimeMix.compressorKneeDb, this.ctx.currentTime, 0.05);
      this.compressor.ratio.setTargetAtTime(realtimeMix.compressorRatio, this.ctx.currentTime, 0.05);
      this.compressor.attack.setTargetAtTime(realtimeMix.compressorAttackSec, this.ctx.currentTime, 0.05);
      this.compressor.release.setTargetAtTime(realtimeMix.compressorReleaseSec, this.ctx.currentTime, 0.05);
    }

    if (this.exhaustFilter) {
      const freqMap = clarityProfile
        ? { stock: 2400, sport: 6200, race: 9000, "straight-pipe": 11000 } as const
        : { stock: 1500, sport: 2800, race: 4800, "straight-pipe": 8500 } as const;
      const tunedFilter = cleanProfile
        ? freqMap[quick.exhaustCharacter] * (clarityProfile ? 1.10 : 1.16) * Math.min(1.45, Math.max(0.62, tuning.clarity / Math.max(0.72, tuning.muffling)))
        : freqMap[quick.exhaustCharacter];
      this.exhaustFilter.frequency.setTargetAtTime(tunedFilter, this.ctx.currentTime, 0.04);
      this.exhaustFilter.Q.setTargetAtTime(clarityProfile ? 0.38 : cleanProfile ? 0.72 / Math.min(1.35, Math.max(0.78, tuning.clarity)) : quick.exhaustCharacter === "straight-pipe" ? 0.55 : 1.1, this.ctx.currentTime, 0.04);
    }

    if (this.intakeFilter) {
      const intakeFreqMap = {
        "single-throttle-body": 650,
        itbs: 1250,
        carb: 850,
        "velocity-stacks": 1550,
        airbox: 520,
      } as const;
      const intakeType = advanced?.intakeType ?? "single-throttle-body";
      this.intakeFilter.frequency.setTargetAtTime(intakeFreqMap[intakeType], this.ctx.currentTime, 0.04);
      this.intakeFilter.Q.setTargetAtTime(clarityProfile ? 0.72 : 1.1, this.ctx.currentTime, 0.04);
    }

    this.dryExhaustGain?.gain.setTargetAtTime(realtimeMix.dryExhaustGain, this.ctx.currentTime, 0.03);
    this.exhaustMixGain?.gain.setTargetAtTime(realtimeMix.filteredExhaustGain, this.ctx.currentTime, 0.03);
    this.intakeMixGain?.gain.setTargetAtTime(realtimeMix.filteredIntakeGain, this.ctx.currentTime, 0.03);

    this.combustionNode?.port.postMessage({
      analysis,
      seed: this.config.seed,
      sound: {
        redline: quick.redline,
        forcedType: forcedInduction.type,
        turboSpoolThreshold: forcedInduction.turboSpoolThreshold ?? 2000,
        turboSize: forcedInduction.turboSize ?? "balanced",
        maxBoost: forcedInduction.maxBoost ?? 15,
        wastegateEnabled: forcedInduction.wastegateEnabled ?? true,
        superchargerType: forcedInduction.superchargerType ?? "roots",
        whineIntensity: forcedInduction.whineIntensity ?? 0.6,
        audioProfile: soundProfile,
        layout: quick.layout,
        crankshaft: quick.crankshaft,
        exhaustCharacter: quick.exhaustCharacter,
        exhaustRouting: advanced?.exhaustRouting ?? (quick.layout === "v" || quick.layout === "flat" ? "dual" : "single"),
        headerGeometry: advanced?.headerGeometry ?? "equal-length",
        tuning,
      },
    });
  }

  private ensureEssNode(): AudioWorkletNode | null {
    if (!this.ctx || !this.masterGain || !this.essReady) return null;
    if (this.essNode) return this.essNode;
    const node = new AudioWorkletNode(this.ctx, "ess-v16-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === "telemetry") {
        this.telemetry = msg.telemetry;
        this.state.rpm = msg.telemetry.rpm;
        this.state.boost = Math.max(0, msg.telemetry.boostKpa / 6.895);
      } else if (msg.type === "ready") {
        this.engineInfo = { firingOrder: msg.firingOrder, intervals: msg.intervals, notes: msg.notes, displacementL: msg.displacementL, internalRate: msg.internalRate };
      } else if (msg.type === "rate") {
        // The worklet stepped the simulator's internal rate down to hold real time on this machine.
        if (this.engineInfo) this.engineInfo = { ...this.engineInfo, internalRate: msg.internalRate };
        console.info(`v16 core: internal rate ${msg.internalRate} Hz (audio thread load ${(msg.load * 100).toFixed(0)} %)`);
      } else if (msg.type === "error") {
        console.warn("v16 core:", msg.message);
      }
    };
    node.connect(this.masterGain);
    this.essNode = node;
    this.postControls();
    if (Object.keys(this.stemGains).length) node.port.postMessage({ type: "stems", stems: this.stemGains });
    return node;
  }

  private postControls(): void {
    this.essNode?.port.postMessage({
      type: "controls",
      controls: { throttle: this.state.throttle, load: this.state.load, targetRpm: this.state.targetRpm, mode: this.driveMode, ...this.vehicleOptions },
    });
  }

  private teardownLegacyNodes(): void {
    this.combustionNode?.disconnect();
    this.combustionNode = null;
    this.resetAccessoryRamps();
  }

  async start(): Promise<void> {
    if (!this.ctx) await this.initialize();
    if (!this.ctx) return;

    if (this.ctx.state === "suspended") await this.ctx.resume();

    if (this.usesPhysicalCore()) {
      this.masterGain?.gain.setValueAtTime(1, this.ctx.currentTime);
      this.limiterGain?.gain.setValueAtTime(1, this.ctx.currentTime);
      // Near-transparent safety compressor: the physics sets the level, not the mix bus.
      if (this.compressor) {
        this.compressor.threshold.value = -1;
        this.compressor.ratio.value = 1.5;
        this.compressor.knee.value = 3;
      }
      this.state.isPlaying = true;
      this.driveMode = "free";
      this.state.throttle = 0;
      this.state.targetRpm = 800;
      this.ensureEssNode();
      this.essNode?.port.postMessage({ type: "config", config: this.config, perspective: this.perspective });
      this.postControls();
      this.startUpdateLoop();
      return;
    }

    if (this.workletReady && !this.combustionNode) {
      this.createCombustionNode();
    } else if (!this.workletReady && !this.combustionNode) {
      this.startFallbackSynthesis();
    }

    this.state.isPlaying = true;
    this.state.rpm = Math.max(800, this.state.rpm || 850);
    this.state.targetRpm = this.state.rpm;
    this.startUpdateLoop();
  }

  private createCombustionNode(): AudioWorkletNode | null {
    if (!this.ctx || !this.masterGain || !this.exhaustFilter || !this.intakeFilter) return null;

    const realtimeMix = resolveRealtimeAudioMixProfile(this.config.soundProfile);

    if (!this.exhaustMixGain) {
      this.exhaustMixGain = this.ctx.createGain();
      this.exhaustMixGain.gain.value = realtimeMix.filteredExhaustGain;
      this.exhaustFilter.connect(this.exhaustMixGain);
      this.exhaustMixGain.connect(this.masterGain);
    }

    if (!this.intakeMixGain) {
      this.intakeMixGain = this.ctx.createGain();
      this.intakeMixGain.gain.value = realtimeMix.filteredIntakeGain;
      this.intakeFilter.connect(this.intakeMixGain);
      this.intakeMixGain.connect(this.masterGain);
    }

    if (!this.dryExhaustGain) {
      this.dryExhaustGain = this.ctx.createGain();
      this.dryExhaustGain.gain.value = realtimeMix.dryExhaustGain;
      this.dryExhaustGain.connect(this.masterGain);
    }

    this.combustionNode?.disconnect();
    this.combustionNode = new AudioWorkletNode(this.ctx, "combustion-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.combustionNode.onprocessorerror = () => {
      this.silentFrameCount = 999;
    };
    this.combustionNode.connect(this.exhaustFilter);
    this.combustionNode.connect(this.intakeFilter);
    this.combustionNode.connect(this.dryExhaustGain);
    this.silentFrameCount = 0;
    this.updateAudioParameters();
    return this.combustionNode;
  }

  private rebuildCombustionNode(): void {
    if (this.rebuildInProgress || !this.ctx || !this.workletReady) return;

    this.rebuildInProgress = true;
    try {
      const nextNode = this.createCombustionNode();
      nextNode?.port.postMessage({
        rpm: Math.max(80, this.state.rpm),
        throttle: this.state.throttle,
        load: this.state.load,
      });
    } finally {
      this.rebuildInProgress = false;
    }
  }

  private startFallbackSynthesis(): void {
    if (!this.ctx || !this.masterGain) return;
    if (this.fallbackOsc) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 90;
    gain.gain.value = 0.24;
    osc.connect(gain);
    gain.connect(this.exhaustFilter!);
    this.exhaustFilter!.connect(this.masterGain);
    osc.start();
    this.fallbackOsc = osc;
    this.fallbackGain = gain;
  }

  stop(): void {
    this.state.isPlaying = false;
    this.essNode?.disconnect();
    this.essNode = null;
    this.telemetry = null;
    this.combustionNode?.disconnect();
    this.combustionNode = null;
    if (this.fallbackOsc) {
      try {
        this.fallbackOsc.stop();
      } catch {
        // Oscillator may already have stopped if the browser tore down audio.
      }
      this.fallbackOsc.disconnect();
      this.fallbackGain?.disconnect();
      this.fallbackOsc = null;
      this.fallbackGain = null;
    }

    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;

    if (this.ctx?.state === "running") {
      void this.ctx.suspend();
    }
  }

  private startUpdateLoop(): void {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);

    const update = () => {
      if (!this.state.isPlaying) return;
      if (this.usesPhysicalCore()) {
        // The physical core owns speed, limiter and inertia; nothing to animate on the main thread.
        this.animationFrame = requestAnimationFrame(update);
        return;
      }

      const limiterRpm = this.config.advanced?.revLimiterRpm || this.config.quick.redline;
      const limiterType = this.config.advanced?.revLimiterType || "soft";
      const limiterMargin = limiterType === "soft" ? 15 : 50;

      if (this.state.rpm >= limiterRpm - limiterMargin) {
        if (limiterType === "hard-fuel-cut" || limiterType === "hard-ignition-cut") {
          if (!this.revLimiterActive) {
            this.revLimiterActive = true;
            this.revLimiterCooldown = 7;
          }
          if (this.revLimiterCooldown > 0) {
            this.state.targetRpm = limiterRpm - 160;
            this.revLimiterCooldown--;
            this.limiterGain?.gain.setTargetAtTime(limiterType === "hard-fuel-cut" ? 0.68 : 0.74, this.ctx!.currentTime, 0.010);
          } else {
            this.revLimiterActive = false;
            this.limiterGain?.gain.setTargetAtTime(1, this.ctx!.currentTime, 0.022);
          }
        } else {
          const overRev = Math.max(0, (this.state.rpm - (limiterRpm - 90)) / 180);
          this.state.targetRpm = Math.min(this.state.targetRpm, limiterRpm - overRev * 70);
          this.limiterGain?.gain.setTargetAtTime(0.92, this.ctx!.currentTime, 0.030);
        }
      } else {
        this.revLimiterActive = false;
        this.limiterGain?.gain.setTargetAtTime(1, this.ctx!.currentTime, 0.05);
      }

      const rpmDiff = this.state.targetRpm - this.state.rpm;
      const inertia = Math.abs(rpmDiff) > 700 ? 0.90 : 0.955;
      this.state.rpm += rpmDiff * (1 - inertia);
      this.updateRealtime();
      this.animationFrame = requestAnimationFrame(update);
    };

    this.animationFrame = requestAnimationFrame(update);
  }

  private updateRealtime(): void {
    if (!this.ctx) return;

    const { rpm, throttle, load } = this.state;
    this.combustionNode?.port.postMessage({ rpm, throttle, load });

    if (this.exhaustFilter) {
      const baseFreq = this.config.quick.exhaustCharacter === "straight-pipe" ? 8500 :
        this.config.quick.exhaustCharacter === "race" ? 4800 :
        this.config.quick.exhaustCharacter === "sport" ? 2800 : 1500;
      const soundProfile = normalizeSoundProfile(this.config.soundProfile);
      const cleanProfile = !isBaselineSoundProfile(soundProfile);
      const clarityProfile = isClaritySoundProfile(soundProfile);
      const tuning = resolveSoundTuningWeights(this.config);
      const clarityBase = clarityProfile
        ? this.config.quick.exhaustCharacter === "straight-pipe" ? 11000 :
          this.config.quick.exhaustCharacter === "race" ? 9000 :
          this.config.quick.exhaustCharacter === "sport" ? 6200 : 2400
        : baseFreq;
      const rpmFactor = 1 + (rpm / this.config.quick.redline) * (clarityProfile ? 0.28 : cleanProfile ? 0.52 : 0.42);
      const tuningFactor = cleanProfile ? Math.min(1.45, Math.max(0.62, tuning.clarity / Math.max(0.72, tuning.muffling))) : 1;
      this.exhaustFilter.frequency.setTargetAtTime(clarityBase * rpmFactor * (clarityProfile ? 1.06 : cleanProfile ? 1.16 : 1) * tuningFactor, this.ctx.currentTime, 0.025);
      const realtimeMix = resolveRealtimeAudioMixProfile(soundProfile);
      this.dryExhaustGain?.gain.setTargetAtTime(realtimeMix.dryExhaustGain, this.ctx.currentTime, 0.04);
      this.exhaustMixGain?.gain.setTargetAtTime(realtimeMix.filteredExhaustGain, this.ctx.currentTime, 0.04);
      this.intakeMixGain?.gain.setTargetAtTime(realtimeMix.filteredIntakeGain, this.ctx.currentTime, 0.04);
    }

    if (this.config.forcedInduction.type === "turbo") {
      this.updateTurboSound(rpm, throttle);
    } else if (this.config.forcedInduction.type === "supercharged") {
      this.updateSuperchargerSound(rpm);
    } else {
      this.state.boost = 0;
      this.turboGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      this.superchargerGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }

    this.monitorOutputContinuity(rpm, throttle, load);
  }

  private monitorOutputContinuity(rpm: number, throttle: number, load: number): void {
    if (!this.analyserNode || !this.state.isPlaying || !this.workletReady) return;

    const shouldHaveOutput = rpm > 700 && (throttle > 0.03 || load > 0.12 || this.state.targetRpm > 950);
    if (!shouldHaveOutput) {
      this.silentFrameCount = 0;
      return;
    }

    if (!this.analyserBuffer || this.analyserBuffer.length !== this.analyserNode.frequencyBinCount) {
      this.analyserBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
    }

    this.analyserNode.getByteTimeDomainData(this.analyserBuffer);
    let deviation = 0;
    for (let i = 0; i < this.analyserBuffer.length; i++) {
      deviation += Math.abs(this.analyserBuffer[i] - 128);
    }
    deviation /= Math.max(1, this.analyserBuffer.length);

    if (deviation < 0.55) {
      this.silentFrameCount++;
    } else {
      this.silentFrameCount = 0;
    }

    if (this.silentFrameCount > 36) {
      this.rebuildCombustionNode();
    }
  }

  private updateTurboSound(rpm: number, throttle: number): void {
    if (!this.ctx || !this.turboOsc || !this.turboGain) return;
    const fi = this.config.forcedInduction;
    const spoolThreshold = fi.turboSpoolThreshold || 2000;
    const sizeLag = fi.turboSize === "small" ? 0.7 : fi.turboSize === "large" ? 1.35 : 1;
    const cleanProfile = !isBaselineSoundProfile(this.config.soundProfile);
    const aboveThreshold = Math.max(0, rpm - spoolThreshold);
    const spoolRange = (cleanProfile ? 1700 : 2600) * sizeLag;
    const earlySpoolLift = cleanProfile && aboveThreshold > 0 ? Math.min(0.28, 0.12 + aboveThreshold / 10000) : 0;
    const spool = Math.max(0, Math.min(1, (aboveThreshold / spoolRange) * throttle * (cleanProfile ? 1.02 : 1) + earlySpoolLift * throttle));
    const tuning = resolveSoundTuningWeights(this.config);
    const realtimeMix = resolveRealtimeAudioMixProfile(this.config.soundProfile);
    const legacyOscillatorGain = this.workletReady ? realtimeMix.legacyForcedInductionOscillatorGain : 1;
    const turboFreq = cleanProfile ? 1800 + spool * 5400 + (rpm / this.config.quick.redline) * 700 : 1700 + spool * 6500 + (rpm / this.config.quick.redline) * 900;
    const turboVol = spool * throttle * (cleanProfile ? 0.005 * tuning.turboTone : 0.055) * legacyOscillatorGain;
    this.turboOsc.frequency.setTargetAtTime(turboFreq, this.ctx.currentTime, 0.06);
    this.turboGain.gain.setTargetAtTime(turboVol, this.ctx.currentTime, 0.04);
    this.superchargerGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    this.state.boost = spool * (fi.maxBoost || 15);
  }

  private updateSuperchargerSound(rpm: number): void {
    if (!this.ctx || !this.superchargerOsc || !this.superchargerGain) return;
    const fi = this.config.forcedInduction;
    const rpmNormalized = rpm / this.config.quick.redline;
    const ratio = fi.superchargerType === "centrifugal" ? 4.8 : fi.superchargerType === "twin-screw" ? 3.7 : 2.9;
    const cleanProfile = !isBaselineSoundProfile(this.config.soundProfile);
    const tuning = resolveSoundTuningWeights(this.config);
    const realtimeMix = resolveRealtimeAudioMixProfile(this.config.soundProfile);
    const legacyOscillatorGain = this.workletReady ? realtimeMix.legacyForcedInductionOscillatorGain : 1;
    const scFreq = (rpm / 60) * ratio * (cleanProfile ? (fi.superchargerType === "roots" ? 9 : 11) : 12);
    const superchargerWake = cleanProfile ? Math.max(0, Math.min(1, (rpm - 900) / 850)) : 1;
    const scVol = superchargerWake * (cleanProfile ? 0.020 + rpmNormalized * 0.034 : rpmNormalized * 0.055) * tuning.superchargerWhine * (fi.whineIntensity || 0.6) * legacyOscillatorGain;
    this.superchargerOsc.frequency.setTargetAtTime(scFreq, this.ctx.currentTime, 0.025);
    this.superchargerGain.gain.setTargetAtTime(scVol, this.ctx.currentTime, 0.025);
    this.turboGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    this.state.boost = rpmNormalized * (fi.superchargerBoost || 10);
  }

  triggerBOV(): void {
    if (!this.ctx || !this.masterGain) return;
    if (this.usesPhysicalCore()) return; // the v16 BOV is a pressure-driven valve in the model
    if (this.config.forcedInduction.type !== "turbo" || !this.config.forcedInduction.bovEnabled) return;

    const bufferSize = Math.floor(this.ctx.sampleRate * 0.34);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const envelope = Math.exp(-i / (bufferSize * 0.18));
      data[i] = (Math.random() * 2 - 1) * envelope;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1750;
    filter.Q.value = 2.4;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.16 + Math.min(this.state.boost / 100, 0.12);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();
  }

  setRPM(rpm: number): void {
    this.state.targetRpm = Math.max(600, Math.min(rpm, this.config.quick.redline));
    if (this.usesPhysicalCore()) {
      // Commanding a speed means putting the engine on the dyno.
      this.driveMode = "dyno";
      this.postControls();
    }
  }

  /** v16: free-running (throttle drives speed) or dyno hold (absorber holds the RPM set-point). */
  setDriveMode(mode: DriveMode): void {
    this.driveMode = mode;
    if (mode === "dyno") this.state.targetRpm = Math.max(600, this.state.rpm || this.state.targetRpm);
    this.postControls();
  }

  /** v16: crank the engine (on) or switch the ignition off (off). */
  setIgnition(on: boolean): void {
    this.essNode?.port.postMessage({ type: "ignition", on });
  }

  /** v16 vehicle mode: request an up (+1) or down (−1) shift. */
  shift(dir: 1 | -1): void {
    this.essNode?.port.postMessage({ type: "shift", dir });
  }

  setVehicleOptions(options: Partial<{ autoShift: boolean; launchControl: boolean; brake: number; exhaustValve: "auto" | "open" | "closed" }>): void {
    this.vehicleOptions = { ...this.vehicleOptions, ...options };
    this.postControls();
  }

  getVehicleOptions() {
    return { ...this.vehicleOptions };
  }

  getDriveMode(): DriveMode {
    return this.driveMode;
  }

  setPerspective(perspective: ListenerPerspective): void {
    this.perspective = perspective;
    this.essNode?.port.postMessage({ type: "perspective", perspective });
  }

  getPerspective(): ListenerPerspective {
    return this.perspective;
  }

  setStemGains(stems: Partial<StemGains>): void {
    this.stemGains = { ...this.stemGains, ...stems };
    this.essNode?.port.postMessage({ type: "stems", stems: this.stemGains });
  }

  getTelemetry(): EngineTelemetry | null {
    return this.telemetry;
  }

  getEngineInfo() {
    return this.engineInfo;
  }

  isPhysicalCoreActive(): boolean {
    return this.usesPhysicalCore();
  }

  setThrottle(throttle: number): void {
    if (this.usesPhysicalCore()) {
      this.state.throttle = Math.max(0, Math.min(1, throttle));
      this.postControls();
      return;
    }
    const previous = this.state.throttle;
    this.state.throttle = Math.max(0, Math.min(1, throttle));
    const idleRpm = 850;
    this.state.targetRpm = idleRpm + (this.config.quick.redline - idleRpm) * this.state.throttle;

    if (previous > 0.5 && throttle < 0.2 && this.state.boost > 5) {
      this.triggerBOV();
    }
  }

  setLoad(load: number): void {
    this.state.load = Math.max(0, Math.min(1, load));
    if (this.usesPhysicalCore()) this.postControls();
  }

  getState(): PlaybackState {
    return { ...this.state, driveMode: this.usesPhysicalCore() ? this.driveMode : undefined, telemetry: this.telemetry ?? undefined };
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  startRecording(): void {
    if (!this.destinationNode) return;
    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(this.destinationNode.stream, { mimeType: "audio/webm;codecs=opus" });
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.recordedChunks.push(event.data);
    };
    this.mediaRecorder.start(100);
  }

  async stopRecording(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(new Blob());
        return;
      }
      this.mediaRecorder.onstop = () => resolve(new Blob(this.recordedChunks, { type: "audio/webm" }));
      this.mediaRecorder.stop();
    });
  }

  async renderOffline(config: EngineConfiguration, durationSec: number, options?: { normalize?: boolean; sampleRate?: number }): Promise<AudioBuffer> {
    const sampleRate = options?.sampleRate || 48000;
    const pcm = isPhysicalSoundProfile(config.soundProfile)
      ? renderEssPcm(config, { durationSec, sampleRate, normalize: options?.normalize, program: "sweep" })
      : generateEnginePcm(config, { durationSec, sampleRate, normalize: options?.normalize, profile: "sweep" });
    if (typeof OfflineAudioContext === "undefined") {
      throw new Error("Offline audio rendering is not available in this browser.");
    }
    const offlineCtx = new OfflineAudioContext(2, pcm.left.length, sampleRate);
    const buffer = offlineCtx.createBuffer(2, pcm.left.length, sampleRate);
    buffer.getChannelData(0).set(pcm.left);
    buffer.getChannelData(1).set(pcm.right);
    return buffer;
  }

  audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = buffer.length * blockAlign;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    this.writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, "WAVE");
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    const channels = Array.from({ length: numChannels }, (_, ch) => buffer.getChannelData(ch));
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  private writeString(view: DataView, offset: number, value: string): void {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  }

  destroy(): void {
    this.stop();
    this.turboOsc?.stop();
    this.turboOsc?.disconnect();
    this.superchargerOsc?.stop();
    this.superchargerOsc?.disconnect();
    this.fallbackOsc?.stop();
    this.fallbackOsc?.disconnect();
    this.fallbackGain?.disconnect();
    this.masterGain?.disconnect();
    this.limiterGain?.disconnect();
    this.compressor?.disconnect();
    this.exhaustFilter?.disconnect();
    this.intakeFilter?.disconnect();
    this.exhaustMixGain?.disconnect();
    this.intakeMixGain?.disconnect();
    this.dryExhaustGain?.disconnect();
    this.turboGain?.disconnect();
    this.superchargerGain?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.limiterGain = null;
    this.combustionNode = null;
    this.exhaustFilter = null;
    this.intakeFilter = null;
    this.exhaustMixGain = null;
    this.intakeMixGain = null;
    this.dryExhaustGain = null;
    this.compressor = null;
    this.turboOsc = null;
    this.turboGain = null;
    this.superchargerOsc = null;
    this.superchargerGain = null;
    this.fallbackOsc = null;
    this.fallbackGain = null;
    this.destinationNode = null;
    this.analyserNode = null;
    this.analyserBuffer = null;
    this.silentFrameCount = 0;
    this.rebuildInProgress = false;
    this.workletReady = false;
    this.isInitialized = false;
  }
}

let engineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (engineInstance && engineInstance.modelVersion !== AUDIO_ENGINE_MODEL_VERSION) {
    engineInstance.destroy();
    engineInstance = null;
  }

  engineInstance ??= new AudioEngine();
  return engineInstance;
}

const hotModule = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;

if (hotModule) {
  hotModule.dispose(() => {
    engineInstance?.destroy();
    engineInstance = null;
  });
}

