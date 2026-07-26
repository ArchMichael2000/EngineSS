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

function instantiate(sampleRate = 44100): WorkletProcessor {
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
  if (!RegisteredProcessor) throw new Error("combustion-processor did not register");
  return new RegisteredProcessor();
}

function configure(processor: WorkletProcessor, config: EngineConfiguration) {
  processor.port.onmessage?.({
    data: {
      analysis: buildEngineSoundAnalysis(config),
      seed: config.seed ?? 42,
      sound: {
        redline: config.quick.redline,
        forcedType: config.forcedInduction.type,
        turboSpoolThreshold: config.forcedInduction.turboSpoolThreshold ?? 3000,
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

function render(config: EngineConfiguration, rpm: number, throttle: number, load: number) {
  const processor = instantiate();
  configure(processor, config);

  let sumSquares = 0;
  let peak = 0;
  let samples = 0;
  let returnedFalse = false;

  for (let block = 0; block < 520; block++) {
    processor.port.onmessage?.({ data: { rpm, throttle, load } });
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    returnedFalse = processor.process([], [[left, right]]) === false || returnedFalse;
    for (let i = 0; i < left.length; i++) {
      const sample = (left[i] + right[i]) * 0.5;
      if (!Number.isFinite(sample)) throw new Error(`Non-finite sample for ${config.quick.cylinderCount} cyl`);
      peak = Math.max(peak, Math.abs(sample));
      if (block > 120) {
        sumSquares += sample * sample;
        samples++;
      }
    }
  }

  return {
    rms: Math.sqrt(sumSquares / Math.max(1, samples)),
    peak,
    returnedFalse,
  };
}

for (const [key, preset] of Object.entries(FACTORY_PRESETS)) {
  const config: EngineConfiguration = { ...preset.config, soundProfile: "v15", seed: 42 };
  const idle = render(config, 900, 0.08, 0.22);
  const mid = render(config, Math.min(config.quick.redline * 0.62, 5200), 0.55, 0.55);
  const high = render(config, config.quick.redline * 0.94, 0.85, 0.65);
  console.log(
    [
      key.padEnd(18),
      `idle rms=${idle.rms.toFixed(5)} peak=${idle.peak.toFixed(3)}`,
      `mid rms=${mid.rms.toFixed(5)} peak=${mid.peak.toFixed(3)}`,
      `high rms=${high.rms.toFixed(5)} peak=${high.peak.toFixed(3)}`,
      `stopped=${idle.returnedFalse || mid.returnedFalse || high.returnedFalse}`,
    ].join(" | "),
  );
}
