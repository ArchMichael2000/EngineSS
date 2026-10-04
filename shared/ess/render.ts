/**
 * Offline rendering on the v16 core (WAV/MP3 export, server renderer, tests).
 * Uses exactly the same EngineSimulator as the live AudioWorklet.
 */
import type { EngineConfiguration } from "../engineTypes";
import { EngineSimulator } from "./engine";
import type { DriveMode } from "./engine";
import type { Perspective } from "./observer";
import { resolveEngineSpec } from "./resolveSpec";

export type EssRenderProgram =
  /** Dyno WOT pull idle → redline, then a closed-throttle lift (decel fuel cut / afterfire). */
  | "sweep"
  /** Hold `endRpm` on the dyno at `throttle`. */
  | "steady"
  /** Free-running: idle, three throttle blips, a full-throttle rev to the limiter, lift-off. */
  | "free-rev";

export interface EssRenderOptions {
  durationSec: number;
  sampleRate?: number;
  program?: EssRenderProgram;
  startRpm?: number;
  endRpm?: number;
  throttle?: number;
  perspective?: Perspective;
  normalize?: boolean;
  /** Seconds of silent pre-roll to settle temperatures, manifold pressure and idle. */
  prerollSec?: number;
}

export interface EssRenderResult {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

const CHUNK = 256;

export function renderEssPcm(config: EngineConfiguration, options: EssRenderOptions): EssRenderResult {
  const sampleRate = options.sampleRate ?? 48000;
  const spec = resolveEngineSpec(config);
  const perspective = options.perspective ?? (config.listener?.perspective as Perspective | undefined) ?? "exterior-rear";
  const sim = new EngineSimulator(spec, sampleRate, { perspective, monitorGainDb: config.listener?.monitorGainDb ?? 0 });
  const program = options.program ?? "sweep";
  const n = Math.max(1, Math.round(options.durationSec * sampleRate));
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const idle = spec.calibration.idleRpm;
  const redline = spec.calibration.redlineRpm;
  const start = options.startRpm ?? Math.max(idle, 1000);
  const end = options.endRpm ?? redline;

  const controlAt = (t: number): { mode: DriveMode; targetRpm: number; throttle: number } => {
    const T = options.durationSec;
    if (program === "steady") return { mode: "dyno", targetRpm: end, throttle: options.throttle ?? 1 };
    if (program === "free-rev") {
      const u = t / T;
      if (u < 0.15) return { mode: "free", targetRpm: idle, throttle: 0 };
      if (u < 0.55) {
        const phase = ((u - 0.15) / 0.4) * 3;
        return { mode: "free", targetRpm: idle, throttle: phase % 1 < 0.18 ? 0.75 : 0 };
      }
      if (u < 0.78) return { mode: "free", targetRpm: idle, throttle: 1 };
      return { mode: "free", targetRpm: idle, throttle: 0 };
    }
    // sweep: 75 % of the time pulling, then lift
    const pull = 0.75 * T;
    if (t < pull) return { mode: "dyno", targetRpm: start + (end - start) * (t / pull), throttle: options.throttle ?? 1 };
    return { mode: "free", targetRpm: idle, throttle: 0 };
  };

  const first = controlAt(0);
  sim.setControls({ ...first, load: 0 });
  sim.prewarm(options.prerollSec ?? 1.5);
  for (let off = 0; off < n; off += CHUNK) {
    sim.setControls(controlAt(off / sampleRate));
    sim.process(left, right, Math.min(CHUNK, n - off), off);
  }

  if (options.normalize) {
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    if (peak > 0) {
      const g = 0.95 / peak;
      for (let i = 0; i < n; i++) {
        left[i] *= g;
        right[i] *= g;
      }
    }
  }
  return { left, right, sampleRate };
}
