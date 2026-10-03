/**
 * AudioWorklet entry for the v16 physical core. Bundled by Vite (`?worker&url`) from the same
 * TypeScript sources the offline renderer and server use — there is no second copy of the DSP.
 */
import { EngineSimulator } from "../../../../shared/ess/engine";
import type { EngineControls, StemGains } from "../../../../shared/ess/engine";
import { resolveEngineSpec } from "../../../../shared/ess/resolveSpec";
import type { Perspective } from "../../../../shared/ess/observer";
import type { EngineConfiguration } from "../../../../shared/engineTypes";

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
  | { type: "monitorGain"; db: number };

const FADE_SAMPLES = 2400;
const TELEMETRY_INTERVAL = 2048;

class EssProcessor extends AudioWorkletProcessor {
  private sim: EngineSimulator | null = null;
  private outgoing: EngineSimulator | null = null;
  private fade = 0;
  private controls: Partial<EngineControls> = { mode: "free", throttle: 0, load: 0 };
  private perspective: Perspective = "exterior-rear";
  private stems: Partial<StemGains> = {};
  private monitorDb = 0;
  private sinceTelemetry = 0;
  private readonly scratchL = new Float32Array(128);
  private readonly scratchR = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<Message>) => this.onMessage(event.data);
  }

  private onMessage(msg: Message): void {
    try {
      switch (msg.type) {
        case "config": {
          if (msg.perspective) this.perspective = msg.perspective;
          const spec = resolveEngineSpec(msg.config);
          const next = new EngineSimulator(spec, sampleRate, { perspective: this.perspective, monitorGainDb: this.monitorDb });
          Object.assign(next.stems, this.stems);
          next.setControls(this.controls);
          this.outgoing = this.sim;
          this.sim = next;
          this.fade = 0;
          this.port.postMessage({ type: "ready", firingOrder: next.schedule.firingOrder, intervals: next.schedule.intervalsDeg, notes: next.schedule.notes, displacementL: next.displacementL });
          break;
        }
        case "controls":
          this.controls = { ...this.controls, ...msg.controls };
          this.sim?.setControls(this.controls);
          this.outgoing?.setControls(this.controls);
          break;
        case "perspective":
          this.perspective = msg.perspective;
          this.sim?.setPerspective(msg.perspective);
          break;
        case "stems":
          this.stems = { ...this.stems, ...msg.stems };
          if (this.sim) Object.assign(this.sim.stems, this.stems);
          break;
        case "monitorGain":
          this.monitorDb = msg.db;
          this.sim?.setMonitorGain(msg.db);
          break;
      }
    } catch (error) {
      this.port.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] ?? out[0];
    if (!left) return true;
    const n = left.length;
    if (!this.sim) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    this.sim.process(left, right, n);
    if (this.fade < FADE_SAMPLES) {
      // Crossfade from the previous engine (config change) or fade in from silence (start).
      const old = this.outgoing;
      if (old) old.process(this.scratchL, this.scratchR, n);
      for (let i = 0; i < n; i++) {
        const g = Math.min(1, (this.fade + i) / FADE_SAMPLES);
        const w = 0.5 - 0.5 * Math.cos(Math.PI * g);
        left[i] = left[i] * w + (old ? this.scratchL[i] * (1 - w) : 0);
        right[i] = right[i] * w + (old ? this.scratchR[i] * (1 - w) : 0);
      }
      this.fade += n;
      if (this.fade >= FADE_SAMPLES) this.outgoing = null;
    }
    this.sinceTelemetry += n;
    if (this.sinceTelemetry >= TELEMETRY_INTERVAL) {
      this.sinceTelemetry = 0;
      this.port.postMessage({ type: "telemetry", telemetry: { ...this.sim.telemetry }, controls: this.sim.currentControls });
    }
    return true;
  }
}

registerProcessor("ess-v16-processor", EssProcessor);
