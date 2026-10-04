/**
 * Engine Sound Simulator - audio engine
 *
 * Real-time playback through the v16 physical core (the "ess-v16-processor" AudioWorklet,
 * client/src/lib/ess/essProcessor.ts) plus offline export through shared/ess/render.ts.
 * The legacy (v0–v15) additive engine lives in legacy/ and is not shipped.
 */

/// <reference lib="dom" />

import type { EngineConfiguration, ListenerPerspective, PlaybackState } from "../../../shared/engineTypes";
import { CURRENT_SOUND_PROFILE, DEFAULT_ENGINE_CONFIG } from "../../../shared/engineTypes";
import type { RenderRequest, RenderResponse } from "./ess/renderWorker";
import type { DriveMode, EngineTelemetry, StemGains } from "../../../shared/ess/engine";
import essProcessorUrl from "./ess/essProcessor?worker&url";

export const AUDIO_ENGINE_MODEL_VERSION = "ess-audio-v16-physical-core";

const UNSUPPORTED_BROWSER_MESSAGE =
  "This simulator needs a Chromium-based browser with AudioWorklet support (Chrome, Edge, Brave or Opera GX).";

type VehicleOptions = { autoShift: boolean; launchControl: boolean; brake: number; exhaustValve?: "auto" | "open" | "closed" };

export class AudioEngine {
  readonly modelVersion = AUDIO_ENGINE_MODEL_VERSION;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isInitialized = false;

  private essNode: AudioWorkletNode | null = null;
  private driveMode: DriveMode = "free";
  /** Vehicle mode options (auto-shift, launch control, brake, exhaust valve override). */
  private vehicleOptions: VehicleOptions = { autoShift: true, launchControl: false, brake: 0 };
  private perspective: ListenerPerspective = "exterior-rear";
  private stemGains: Partial<StemGains> = {};
  private telemetry: EngineTelemetry | null = null;
  /** Audio-thread figures from the worklet: measured load, learned machine factor, internal rate. */
  private audioStats: { load: number; machineFactor: number; internalRate: number; tier: number } | null = null;
  private engineInfo: { firingOrder: number[]; intervals: number[]; notes: string[]; displacementL: number; internalRate?: number; builds: number } | null = null;

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

    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw new Error(UNSUPPORTED_BROWSER_MESSAGE);
    }
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    if (!ctx.audioWorklet) {
      void ctx.close();
      throw new Error(UNSUPPORTED_BROWSER_MESSAGE);
    }
    try {
      await ctx.audioWorklet.addModule(essProcessorUrl);
    } catch (error) {
      void ctx.close();
      console.warn("v16 core: failed to load the audio worklet", error);
      throw new Error(`The engine audio processor failed to load. ${UNSUPPORTED_BROWSER_MESSAGE}`);
    }
    this.ctx = ctx;
    this.setupAudioGraph();
    this.isInitialized = true;
  }

  private setupAudioGraph(): void {
    if (!this.ctx) return;

    // Output limiter. The physics sets the level (each perspective maps a fixed dB SPL to full
    // scale), and loud engines legitimately peak above it: a V12 at full throttle reaches about
    // +2.5 dBFS at the rear, 3 m. Below −3 dBFS this is transparent; above, the 20:1 ratio and
    // the node's 6 ms look-ahead hold peaks near −1 dBFS (including the spec's automatic makeup
    // gain of about +1.7 dB), so level differences between engines survive and nothing clips.
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -3;
    this.compressor.knee.value = 1;
    this.compressor.ratio.value = 20;
    this.compressor.attack.value = 0.001;
    this.compressor.release.value = 0.12;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;

    this.destinationNode = this.ctx.createMediaStreamDestination();
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.78;

    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
    this.compressor.connect(this.destinationNode);
    this.compressor.connect(this.analyserNode);
  }

  setConfig(config: EngineConfiguration): void {
    // Saved configurations from the legacy profiles load into the physical core.
    const nextConfig = { ...config, soundProfile: CURRENT_SOUND_PROFILE, seed: config.seed ?? 42 };
    if (config.listener?.perspective) this.perspective = config.listener.perspective;
    this.config = nextConfig;
    if (this.state.isPlaying) {
      this.ensureEssNode();
      this.essNode?.port.postMessage({ type: "config", config: nextConfig, perspective: this.perspective });
    }
  }

  private ensureEssNode(): AudioWorkletNode | null {
    if (!this.ctx || !this.masterGain) return null;
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
        if (msg.audio) this.audioStats = msg.audio;
      } else if (msg.type === "ready") {
        this.engineInfo = { firingOrder: msg.firingOrder, intervals: msg.intervals, notes: msg.notes, displacementL: msg.displacementL, internalRate: msg.internalRate, builds: (this.engineInfo?.builds ?? 0) + 1 };
      } else if (msg.type === "rate") {
        // The worklet stepped the simulator's internal rate down to hold real time on this machine.
        if (this.engineInfo) this.engineInfo = { ...this.engineInfo, internalRate: msg.internalRate };
        console.info(`v16 core: internal rate ${msg.internalRate} Hz (audio thread load ${(msg.load * 100).toFixed(0)} %)`);
      } else if (msg.type === "error") {
        console.warn("v16 core:", msg.message);
      }
    };
    node.onprocessorerror = (event) => {
      console.error("v16 core: audio processor error", event);
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

  async start(): Promise<void> {
    if (!this.ctx) await this.initialize();
    if (!this.ctx) return;

    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.state.isPlaying = true;
    this.driveMode = "free";
    this.state.throttle = 0;
    this.state.targetRpm = 800;
    this.ensureEssNode();
    this.essNode?.port.postMessage({ type: "config", config: this.config, perspective: this.perspective });
    this.postControls();
  }

  stop(): void {
    this.state.isPlaying = false;
    this.essNode?.disconnect();
    this.essNode = null;
    this.telemetry = null;

    if (this.ctx?.state === "running") {
      void this.ctx.suspend();
    }
  }

  setRPM(rpm: number): void {
    this.state.targetRpm = Math.max(600, Math.min(rpm, this.config.quick.redline));
    // Commanding a speed means putting the engine on the dyno.
    this.driveMode = "dyno";
    this.postControls();
  }

  /** Free-running (throttle drives speed), dyno hold (absorber holds the RPM set-point) or vehicle. */
  setDriveMode(mode: DriveMode): void {
    this.driveMode = mode;
    if (mode === "dyno") this.state.targetRpm = Math.max(600, this.state.rpm || this.state.targetRpm);
    this.postControls();
  }

  /** Crank the engine (on) or switch the ignition off (off). */
  setIgnition(on: boolean): void {
    this.essNode?.port.postMessage({ type: "ignition", on });
  }

  /** Vehicle mode: request an up (+1) or down (−1) shift. */
  shift(dir: 1 | -1): void {
    this.essNode?.port.postMessage({ type: "shift", dir });
  }

  setVehicleOptions(options: Partial<VehicleOptions>): void {
    this.vehicleOptions = { ...this.vehicleOptions, ...options };
    this.postControls();
  }

  getVehicleOptions(): VehicleOptions {
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

  getAudioStats() {
    return this.audioStats;
  }

  setThrottle(throttle: number): void {
    this.state.throttle = Math.max(0, Math.min(1, throttle));
    this.postControls();
  }

  setLoad(load: number): void {
    this.state.load = Math.max(0, Math.min(1, load));
    this.postControls();
  }

  getState(): PlaybackState {
    return { ...this.state, driveMode: this.driveMode, telemetry: this.telemetry ?? undefined };
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  /** Taps the output bus (after the safety compressor); used by recording and browser tests. */
  getOutputStream(): MediaStream | null {
    return this.destinationNode?.stream ?? null;
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
    const pcm = await renderInWorker({ config, options: { durationSec, sampleRate, normalize: options?.normalize, program: "sweep" } });
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
    this.masterGain?.disconnect();
    this.compressor?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.destinationNode = null;
    this.analyserNode = null;
    this.isInitialized = false;
  }
}

/** Renders a clip in a Web Worker (client/src/lib/ess/renderWorker.ts) and resolves with the PCM. */
function renderInWorker(request: RenderRequest): Promise<{ left: Float32Array; right: Float32Array }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ess/renderWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve({ left: event.data.left, right: event.data.right });
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The export renderer failed to start."));
    };
    worker.postMessage(request);
  });
}

let engineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (engineInstance && engineInstance.modelVersion !== AUDIO_ENGINE_MODEL_VERSION) {
    engineInstance.destroy();
    engineInstance = null;
  }

  engineInstance ??= new AudioEngine();
  exposeForTesting(engineInstance);
  return engineInstance;
}

/** Dev builds, or any build opened with ?essDebug, expose the engine as window.__ess for browser tests. */
function exposeForTesting(engine: AudioEngine): void {
  if (typeof window === "undefined") return;
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has("essDebug")) {
    (window as typeof window & { __ess?: AudioEngine }).__ess = engine;
  }
}

const hotModule = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;

if (hotModule) {
  hotModule.dispose(() => {
    engineInstance?.destroy();
    engineInstance = null;
  });
}
