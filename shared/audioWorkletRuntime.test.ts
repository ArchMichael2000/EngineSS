import { describe, expect, it } from "vitest";
import { COMBUSTION_PROCESSOR_CODE } from "../client/src/lib/audioEngine";
import { buildEngineSoundAnalysis, resolveSoundTuningWeights } from "./engineSoundModel";
import { FACTORY_PRESETS } from "./engineTypes";
import type { EngineConfiguration } from "./engineTypes";

class FakeAudioWorkletProcessor {
  port = {
    onmessage: null as null | ((event: { data: unknown }) => void),
  };
}

type WorkletProcessor = {
  port: FakeAudioWorkletProcessor["port"];
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};

function instantiateCombustionProcessor(sampleRate = 44100): WorkletProcessor {
  let ProcessorCtor: { new(): WorkletProcessor } | null = null;
  const registerProcessor = (name: string, ctor: { new(): WorkletProcessor }) => {
    if (name === "combustion-processor") ProcessorCtor = ctor;
  };

  const evaluate = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    "sampleRate",
    `${COMBUSTION_PROCESSOR_CODE}\nreturn true;`,
  );
  evaluate(FakeAudioWorkletProcessor, registerProcessor, sampleRate);

  const RegisteredProcessor = ProcessorCtor as { new(): WorkletProcessor } | null;
  if (!RegisteredProcessor) {
    throw new Error("combustion-processor did not register");
  }

  return new RegisteredProcessor();
}

function configureProcessor(processor: WorkletProcessor, config: EngineConfiguration) {
  processor.port.onmessage?.({
    data: {
      analysis: buildEngineSoundAnalysis(config),
      seed: config.seed ?? 42,
      sound: {
        redline: config.quick.redline,
        forcedType: config.forcedInduction.type,
        turboSpoolThreshold: config.forcedInduction.turboSpoolThreshold ?? 2000,
        turboSize: config.forcedInduction.turboSize ?? "balanced",
        maxBoost: config.forcedInduction.maxBoost ?? 15,
        wastegateEnabled: config.forcedInduction.wastegateEnabled ?? true,
        superchargerType: config.forcedInduction.superchargerType ?? "roots",
        whineIntensity: config.forcedInduction.whineIntensity ?? 0.6,
        audioProfile: config.soundProfile ?? "v15",
        layout: config.quick.layout,
        crankshaft: config.quick.crankshaft,
        exhaustCharacter: config.quick.exhaustCharacter,
        tuning: resolveSoundTuningWeights(config),
      },
    },
  });
}

function renderWorklet(
  config: EngineConfiguration,
  blocks: number,
  controlForBlock: (block: number) => { rpm: number; throttle: number; load: number },
) {
  const processor = instantiateCombustionProcessor();
  configureProcessor(processor, config);

  const samples: number[] = [];
  let returnedFalseAt: number | null = null;
  let peak = 0;
  let sumSquares = 0;
  let midSquares = 0;
  let sideSquares = 0;

  for (let block = 0; block < blocks; block++) {
    processor.port.onmessage?.({ data: controlForBlock(block) });
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    const keepAlive = processor.process([], [[left, right]]);
    if (!keepAlive && returnedFalseAt === null) returnedFalseAt = block;

    for (let i = 0; i < left.length; i++) {
      const sample = (left[i] + right[i]) * 0.5;
      const side = (left[i] - right[i]) * 0.5;
      expect(Number.isFinite(sample)).toBe(true);
      expect(Number.isFinite(side)).toBe(true);
      samples.push(sample);
      peak = Math.max(peak, Math.abs(sample));
      sumSquares += sample * sample;
      if (block > blocks * 0.25) {
        midSquares += sample * sample;
        sideSquares += side * side;
      }
    }
  }

  return {
    returnedFalseAt,
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
    tailRms: rms(samples.slice(Math.floor(samples.length * 0.72))),
    sideMidRatio: Math.sqrt(sideSquares / Math.max(1e-9, midSquares)),
  };
}

function rms(samples: number[]) {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / Math.max(1, samples.length));
}

describe("browser AudioWorklet runtime", () => {
  it("keeps the exact worklet alive and audible for V12", () => {
    const config = { ...FACTORY_PRESETS["v12"].config, soundProfile: "v15" as const, seed: 42 };
    const render = renderWorklet(config, 520, () => ({
      rpm: 4200,
      throttle: 0.55,
      load: 0.55,
    }));

    expect(render.returnedFalseAt).toBeNull();
    expect(render.peak).toBeGreaterThan(0.03);
    expect(render.rms).toBeGreaterThan(0.006);
    expect(render.tailRms).toBeGreaterThan(0.005);
    expect(render.peak).toBeLessThanOrEqual(1);
    expect(render.sideMidRatio).toBeLessThan(0.34);
  });

  it("does not die or go silent when V8 crosses 6000 RPM", () => {
    const config = { ...FACTORY_PRESETS["v8-crossplane"].config, soundProfile: "v15" as const, seed: 42 };
    const render = renderWorklet(config, 700, (block) => {
      const progress = block / 699;
      return {
        rpm: 5200 + progress * 1500,
        throttle: 0.85,
        load: 0.65,
      };
    });

    expect(render.returnedFalseAt).toBeNull();
    expect(render.peak).toBeGreaterThan(0.04);
    expect(render.rms).toBeGreaterThan(0.007);
    expect(render.tailRms).toBeGreaterThan(0.006);
    expect(render.peak).toBeLessThanOrEqual(1);
  });

  it("does not die or go silent when dense engines run past 8000 RPM", () => {
    const config = {
      ...FACTORY_PRESETS["v12"].config,
      soundProfile: "v15" as const,
      seed: 42,
      quick: {
        ...FACTORY_PRESETS["v12"].config.quick,
        redline: 9500,
      },
    };
    const render = renderWorklet(config, 760, (block) => {
      const progress = block / 759;
      return {
        rpm: 8000 + progress * 1100,
        throttle: 0.86,
        load: 0.72,
      };
    });

    expect(render.returnedFalseAt).toBeNull();
    expect(render.peak).toBeGreaterThan(0.035);
    expect(render.rms).toBeGreaterThan(0.007);
    expect(render.tailRms).toBeGreaterThan(0.006);
    expect(render.sideMidRatio).toBeLessThan(0.34);
    expect(render.peak).toBeLessThanOrEqual(1);
  });

  it("keeps current worklet loudness stable from V8 to V12", () => {
    const renderV8 = renderWorklet({ ...FACTORY_PRESETS["v8-crossplane"].config, soundProfile: "v15" as const, seed: 42 }, 560, () => ({
      rpm: 3600,
      throttle: 0.58,
      load: 0.62,
    }));
    const renderV12 = renderWorklet({ ...FACTORY_PRESETS["v12"].config, soundProfile: "v15" as const, seed: 42 }, 560, () => ({
      rpm: 3600,
      throttle: 0.58,
      load: 0.62,
    }));

    expect(renderV12.returnedFalseAt).toBeNull();
    expect(renderV12.rms).toBeGreaterThan(renderV8.rms * 0.78);
    expect(renderV12.tailRms).toBeGreaterThan(0.006);
    expect(renderV12.peak).toBeLessThanOrEqual(1);
  });

  it("flushes old combustion state when presets change during an RPM sweep", () => {
    const processor = instantiateCombustionProcessor();
    const v8 = { ...FACTORY_PRESETS["v8-crossplane"].config, soundProfile: "v15" as const, seed: 42 };
    const v12 = { ...FACTORY_PRESETS["v12"].config, soundProfile: "v15" as const, seed: 77 };
    const internals = processor as WorkletProcessor & { pulses?: unknown[]; analysis?: { cylinderCount?: number } };

    configureProcessor(processor, v8);
    for (let block = 0; block < 180; block++) {
      processor.port.onmessage?.({
        data: {
          rpm: 3600 + block * 16,
          throttle: 0.72,
          load: 0.62,
        },
      });
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      expect(processor.process([], [[left, right]])).toBe(true);
    }

    expect((internals.pulses?.length ?? 0)).toBeGreaterThan(0);
    configureProcessor(processor, v12);
    expect(internals.analysis?.cylinderCount).toBe(12);
    expect(internals.pulses ?? []).toHaveLength(0);

    let sumSquares = 0;
    let peak = 0;
    for (let block = 0; block < 320; block++) {
      processor.port.onmessage?.({
        data: {
          rpm: 6100 + block * 5,
          throttle: 0.70,
          load: 0.62,
        },
      });
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      expect(processor.process([], [[left, right]])).toBe(true);
      for (let i = 0; i < left.length; i++) {
        const sample = (left[i] + right[i]) * 0.5;
        expect(Number.isFinite(sample)).toBe(true);
        peak = Math.max(peak, Math.abs(sample));
        if (block > 80) sumSquares += sample * sample;
      }
    }

    const steadyRms = Math.sqrt(sumSquares / Math.max(1, (320 - 81) * 128));
    expect(peak).toBeGreaterThan(0.035);
    expect(steadyRms).toBeGreaterThan(0.006);
    expect(peak).toBeLessThanOrEqual(1);
  });
});
