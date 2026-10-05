/**
 * AudioWorklet entry for the v16 physical core. Bundled by Vite (`?worker&url`) from the same
 * TypeScript sources the offline renderer and server use — there is no second copy of the DSP.
 */
import { EngineSimulator } from "../../../../shared/ess/engine";
import type { EngineControls, StemGains } from "../../../../shared/ess/engine";
import { resolveEngineSpec } from "../../../../shared/ess/resolveSpec";
import type { Perspective } from "../../../../shared/ess/observer";
import type { EngineConfiguration } from "../../../../shared/engineTypes";
import { RATE_TIERS, Upsampler } from "../../../../shared/ess/resample";
import { OutputLeveler } from "../../../../shared/ess/leveler";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

type Message =
  | { type: "config"; config: EngineConfiguration; perspective?: Perspective }
  | { type: "controls"; controls: Partial<EngineControls> }
  | { type: "perspective"; perspective: Perspective }
  | { type: "stems"; stems: Partial<StemGains> }
  | { type: "monitorGain"; db: number }
  | { type: "shift"; dir: 1 | -1 }
  | { type: "ignition"; on: boolean }
  | { type: "autoLevel"; on: boolean }
  /** The node is being discarded: stop rendering and let the browser collect the processor. */
  | { type: "dispose" };

const FADE_SAMPLES = 2400;
const TELEMETRY_INTERVAL = 2048;
/** Target share of the audio thread's time budget the simulator may use. */
const LOAD_TARGET = 0.6;
/** Sustained load above this steps the running engine down one rate tier. */
const LOAD_OVERLOAD = 0.9;
const LOAD_WINDOW_SAMPLES = 24000;

const now = (): number => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

/** A simulator running at an internal rate, upsampled to the device rate when reduced. */
class Voice {
  readonly upsampler: Upsampler | null;
  constructor(readonly sim: EngineSimulator, readonly tier: number) {
    this.upsampler = tier < RATE_TIERS.length && RATE_TIERS[tier] < 1 ? new Upsampler(sim.sampleRate, sampleRate, (l, r, n) => sim.process(l, r, n)) : null;
  }
  render(left: Float32Array, right: Float32Array, n: number): void {
    if (this.upsampler) this.upsampler.process(left, right, n);
    else this.sim.process(left, right, n);
  }
}

class EssProcessor extends AudioWorkletProcessor {
  private voice: Voice | null = null;
  private outgoing: Voice | null = null;
  private config: EngineConfiguration | null = null;
  /** Measured CPU speed relative to the reference machine the cost estimate was fitted on. */
  private machineFactor = 0.75; // start optimistic; overloads step down and refine it
  private loadMs = 0;
  private loadSamples = 0;
  private overloadWindows = 0;
  /** Last measured share of the audio thread's time budget (0–1+), for telemetry. */
  private lastLoad = 0;
  private fade = 0;
  private controls: Partial<EngineControls> = { mode: "free", throttle: 0, load: 0 };
  private perspective: Perspective = "exterior-rear";
  private stems: Partial<StemGains> = {};
  private monitorDb = 0;
  private sinceTelemetry = 0;
  private readonly scratchL = new Float32Array(128);
  private readonly scratchR = new Float32Array(128);
  /** Gain staging after the crossfade (shared/ess/leveler.ts), identical to the offline export. */
  private readonly leveler = new OutputLeveler(sampleRate);
  private disposed = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<Message>) => this.onMessage(event.data);
  }

  private onMessage(msg: Message): void {
    try {
      switch (msg.type) {
        case "config": {
          if (msg.perspective) this.perspective = msg.perspective;
          this.config = msg.config;
          if (msg.config.listener?.autoLevel !== undefined) this.leveler.autoGain = msg.config.listener.autoLevel;
          const next = this.build(msg.config, null);
          this.port.postMessage({ type: "ready", firingOrder: next.sim.schedule.firingOrder, intervals: next.sim.schedule.intervalsDeg, notes: next.sim.schedule.notes, displacementL: next.sim.displacementL, internalRate: next.sim.sampleRate });
          break;
        }
        case "controls":
          this.controls = { ...this.controls, ...msg.controls };
          this.voice?.sim.setControls(this.controls);
          this.outgoing?.sim.setControls(this.controls);
          break;
        case "perspective":
          this.perspective = msg.perspective;
          this.voice?.sim.setPerspective(msg.perspective);
          break;
        case "stems":
          this.stems = { ...this.stems, ...msg.stems };
          if (this.voice) Object.assign(this.voice.sim.stems, this.stems);
          break;
        case "ignition":
          if (msg.on) this.voice?.sim.start();
          else this.voice?.sim.stopEngine();
          break;
        case "shift":
          this.voice?.sim.shift(msg.dir);
          break;
        case "monitorGain":
          this.monitorDb = msg.db;
          this.voice?.sim.setMonitorGain(msg.db);
          break;
        case "autoLevel":
          this.leveler.autoGain = msg.on;
          break;
        case "dispose":
          this.disposed = true;
          this.voice = null;
          this.outgoing = null;
          this.port.onmessage = null;
          break;
      }
    } catch (error) {
      this.port.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Build a voice at the highest rate tier whose estimated load fits the budget (or at `forceTier`).
   * Physics is rate-independent, so a reduced tier changes only the audio bandwidth.
   */
  private build(config: EngineConfiguration, forceTier: number | null): Voice {
    const spec = resolveEngineSpec(config);
    const make = (tier: number) => {
      const sim = new EngineSimulator(spec, Math.round(sampleRate * RATE_TIERS[tier]), { perspective: this.perspective, monitorGainDb: this.monitorDb });
      Object.assign(sim.stems, this.stems);
      sim.setControls(this.controls);
      return sim;
    };
    let tier = forceTier ?? 0;
    let sim = make(tier);
    if (forceTier === null) {
      const full = sim.costEstimate * this.machineFactor;
      while (tier < RATE_TIERS.length - 1 && full * RATE_TIERS[tier] > LOAD_TARGET) tier++;
      if (tier > 0) sim = make(tier);
    }
    const voice = new Voice(sim, tier);
    this.outgoing = this.voice;
    this.voice = voice;
    this.fade = 0;
    this.loadMs = 0;
    this.loadSamples = 0;
    this.overloadWindows = 0;
    return voice;
  }

  /** Learn the machine factor from measured load; step down a tier if the audio thread overruns. */
  private measureLoad(ms: number, n: number): void {
    const voice = this.voice;
    if (!voice || this.outgoing) return; // crossfades run two engines: not representative
    this.loadMs += ms;
    this.loadSamples += n;
    if (this.loadSamples < LOAD_WINDOW_SAMPLES) return;
    const load = this.loadMs / ((this.loadSamples / sampleRate) * 1000);
    this.lastLoad = load;
    this.loadMs = 0;
    this.loadSamples = 0;
    const measured = load / Math.max(0.01, voice.sim.costEstimate);
    this.machineFactor += (measured - this.machineFactor) * 0.5;
    this.overloadWindows = load > LOAD_OVERLOAD ? this.overloadWindows + 1 : 0;
    if (this.overloadWindows >= 2 && voice.tier < RATE_TIERS.length - 1 && this.config) {
      const next = this.build(this.config, voice.tier + 1);
      this.port.postMessage({ type: "rate", internalRate: next.sim.sampleRate, load });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed) return false;
    const out = outputs[0];
    const left = out[0];
    if (!left) return true;
    const right = out[1] ?? this.monoScratch(left.length);
    const n = left.length;
    const voice = this.voice;
    if (!voice) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    const t0 = now();
    voice.render(left, right, n);
    this.measureLoad(now() - t0, n);
    if (this.fade < FADE_SAMPLES) {
      // Crossfade from the previous engine (config change) or fade in from silence (start).
      const old = this.outgoing;
      if (old) old.render(this.scratchL, this.scratchR, n);
      for (let i = 0; i < n; i++) {
        const g = Math.min(1, (this.fade + i) / FADE_SAMPLES);
        const w = 0.5 - 0.5 * Math.cos(Math.PI * g);
        left[i] = left[i] * w + (old ? this.scratchL[i] * (1 - w) : 0);
        right[i] = right[i] * w + (old ? this.scratchR[i] * (1 - w) : 0);
      }
      this.fade += n;
      if (this.fade >= FADE_SAMPLES) this.outgoing = null;
    }
    this.leveler.process(left, right, n);
    this.sinceTelemetry += n;
    if (this.sinceTelemetry >= TELEMETRY_INTERVAL) {
      this.sinceTelemetry = 0;
      this.port.postMessage({ type: "telemetry", telemetry: { ...voice.sim.telemetry }, controls: voice.sim.currentControls, audio: { load: this.lastLoad, machineFactor: this.machineFactor, internalRate: voice.sim.sampleRate, tier: voice.tier, levelDb: 20 * Math.log10(Math.max(1e-6, this.leveler.lastGain)), autoLevel: this.leveler.autoGain } });
    }
    return true;
  }

  private monoRight: Float32Array | null = null;
  /** A throwaway right channel for a mono output, so the leveler never processes one buffer twice. */
  private monoScratch(n: number): Float32Array {
    if (!this.monoRight || this.monoRight.length !== n) this.monoRight = new Float32Array(n);
    return this.monoRight;
  }
}

registerProcessor("ess-v16-processor", EssProcessor);
