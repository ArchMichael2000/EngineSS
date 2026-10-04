/**
 * Test-only AudioWorklet (dev server only, loaded through /@fs): renders an engine in one long burst
 * on the audio thread and reports the time, to compare V8 speed there against the main thread and Node.
 */
import { EngineSimulator } from "../../shared/ess/engine";
import { resolveEngineSpec } from "../../shared/ess/resolveSpec";
import { REFERENCE_ENGINES } from "../../shared/ess/reference/engines";

declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor(); }

export function bench(key: string, rate: number, seconds: number, clock: () => number): number {
  const spec = resolveEngineSpec({ ...REFERENCE_ENGINES[key].config, soundProfile: "v16" } as never);
  const sim = new EngineSimulator(spec, rate, { perspective: "exterior-rear" });
  const l = new Float32Array(128), r = new Float32Array(128);
  sim.setControls({ mode: "free", throttle: 0, load: 0 });
  for (let i = 0; i < rate / 128; i++) sim.process(l, r, 128);
  const t0 = clock();
  const blocks = Math.floor((seconds * rate) / 128);
  for (let i = 0; i < blocks; i++) { if (i === Math.floor(rate / 128)) sim.setControls({ throttle: 1 }); sim.process(l, r, 128); }
  return (clock() - t0) / 1000 / seconds;
}

if (typeof registerProcessor === "function") {
  class BenchProcessor extends AudioWorkletProcessor {
    private live: EngineSimulator | null = null;
    private busyMs = 0;
    private blocks = 0;
    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<{ key: string; rate: number; seconds: number; live?: boolean; report?: boolean }>) => {
        const { key, rate, seconds, live, report } = e.data;
        if (report) {
          this.port.postMessage({ key, rate, realTimeFactor: this.busyMs / ((this.blocks * 128) / 48000 * 1000) });
          this.live = null;
          return;
        }
        if (live) {
          // Real-time mode: render one 128-sample block per process() call, timed per block like essProcessor.
          const spec = resolveEngineSpec({ ...REFERENCE_ENGINES[key].config, soundProfile: "v16" } as never);
          this.live = new EngineSimulator(spec, 48000, { perspective: "exterior-rear" });
          this.live.setControls({ mode: "free", throttle: 1, load: 0 });
          this.busyMs = 0;
          this.blocks = 0;
          return;
        }
        this.port.postMessage({ key, rate, realTimeFactor: bench(key, rate, seconds, Date.now) });
      };
    }
    process(_i: Float32Array[][], outputs: Float32Array[][]) {
      if (this.live) {
        const t0 = Date.now();
        this.live.process(outputs[0][0], outputs[0][1] ?? outputs[0][0], outputs[0][0].length);
        this.busyMs += Date.now() - t0;
        this.blocks++;
      }
      return true;
    }
  }
  registerProcessor("ess-bench", BenchProcessor);
}
