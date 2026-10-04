import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REFERENCE_ENGINES } from "../../../../shared/ess/reference/engines";

// Runs the real worklet class in Node with stand-ins for the AudioWorkletGlobalScope, and a clock
// that reports each 128-sample block as taking 2.5 ms of a 2.67 ms budget (94 % load). The
// processor must step down one rate tier, say so, and crossfade with no gap in the output.

type Processor = { port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void }; process: (i: Float32Array[][], o: Float32Array[][]) => boolean };

const messages: Array<Record<string, unknown>> = [];
let ProcessorCtor: (new () => Processor) | null = null;
let clock = 0;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = 48000;
  g.registerProcessor = (_name: string, ctor: new () => Processor) => { ProcessorCtor = ctor; };
  g.AudioWorkletProcessor = class {
    port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (m: unknown) => messages.push(m as Record<string, unknown>) };
  };
  // Alternate calls are block start and block end: each block "takes" 2.5 ms.
  let calls = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    calls++;
    if (calls % 2 === 0) clock += 2.5;
    else clock += 0.1;
    return clock;
  });
  await import("./essProcessor");
});

afterAll(() => vi.restoreAllMocks());

describe("essProcessor rate tiering", () => {
  it("steps down tier by tier under sustained overload, stops at the lowest, and crossfades without a gap", () => {
    expect(ProcessorCtor).not.toBeNull();
    const proc = new ProcessorCtor!();
    proc.port.onmessage!({ data: { type: "config", config: REFERENCE_ENGINES["honda-k20a"].config } });
    const ready = messages.find((m) => m.type === "ready");
    expect(ready?.internalRate).toBe(48000);

    const left = new Float32Array(128);
    const right = new Float32Array(128);
    const out = [[left, right]];
    let quietRun = 0;
    let maxQuietRun = 0;
    let stepBlock = -1;
    for (let b = 0; b < 1400; b++) {
      proc.process([], out);
      if (stepBlock < 0 && messages.some((m) => m.type === "rate")) stepBlock = b;
      if (b < 40) continue; // fade-in from silence at start
      for (let i = 0; i < 128; i++) {
        const v = Math.max(Math.abs(left[i]), Math.abs(right[i]));
        expect(Number.isFinite(v)).toBe(true);
        if (v < 1e-6) { quietRun++; maxQuietRun = Math.max(maxQuietRun, quietRun); } else quietRun = 0;
      }
    }
    const rate = messages.find((m) => m.type === "rate");
    expect(rate?.internalRate).toBe(40000); // 5/6 of 48 kHz
    expect(rate?.load as number).toBeGreaterThan(0.9);
    // Two 0.5 s load windows over budget trigger the step: about 375 blocks.
    expect(stepBlock).toBeGreaterThan(300);
    expect(stepBlock).toBeLessThan(450);
    expect(maxQuietRun).toBeLessThan(48); // < 1 ms of silence anywhere, crossfade included
    // The fake clock keeps reporting overload, so it steps again to the lowest tier and stays there.
    expect(messages.filter((m) => m.type === "rate").map((m) => m.internalRate)).toEqual([40000, 32000]);
    const tele = messages.filter((m) => m.type === "telemetry").at(-1) as { audio: { tier: number; internalRate: number } };
    expect(tele.audio.tier).toBe(2);
    expect(tele.audio.internalRate).toBe(32000);
  }, 60_000); // about 3 s alone; much longer on a shared CI runner
});
