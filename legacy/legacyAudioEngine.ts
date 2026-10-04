/**
 * Legacy (v0–v15) live audio engine, as it shipped before the v16 physical core.
 *
 * Real-time Web Audio playback through the additive "combustion-processor" worklet plus
 * offline export through legacy/engineSoundModel.ts. Kept so the old profiles stay
 * runnable for A/B comparison; the shipped app uses client/src/lib/audioEngine.ts.
 */

/// <reference lib="dom" />

import type { EngineConfiguration, PlaybackState } from "../shared/engineTypes";
import { DEFAULT_ENGINE_CONFIG } from "../shared/engineTypes";
import { buildEngineSoundAnalysis, generateEnginePcm, resolveSoundTuningWeights } from "./engineSoundModel";
import { resolveLiveOutputGain, resolveRealtimeAudioMixProfile } from "./realtimeAudioMix";
import { isBaselineSoundProfile, isClaritySoundProfile, LEGACY_SOUND_PROFILE, normalizeSoundProfile } from "./soundProfiles";
import { COMBUSTION_PROCESSOR_CODE } from "./combustionProcessor";


export const LEGACY_AUDIO_ENGINE_MODEL_VERSION = "ess-audio-v15-legacy";

export class LegacyAudioEngine {
  readonly modelVersion = LEGACY_AUDIO_ENGINE_MODEL_VERSION;

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

  setConfig(config: EngineConfiguration): void {
    // There is no physical core here: an unset or v16 profile renders with the latest legacy (v15) behaviour.
    const profile = normalizeSoundProfile(config.soundProfile);
    const nextConfig = { ...config, soundProfile: profile === "v16" ? LEGACY_SOUND_PROFILE : profile, seed: config.seed ?? 42 };
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

  async start(): Promise<void> {
    if (!this.ctx) await this.initialize();
    if (!this.ctx) return;

    if (this.ctx.state === "suspended") await this.ctx.resume();

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
  }

  setThrottle(throttle: number): void {
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
  }

  getState(): PlaybackState {
    return { ...this.state };
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
    const pcm = generateEnginePcm(config, { durationSec, sampleRate, normalize: options?.normalize, profile: "sweep" });
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
