declare module "essentia.js" {
  export const EssentiaWASM: unknown;
  export class Essentia {
    constructor(wasmModule: unknown, isDebug?: boolean);
    arrayToVector(inputArray: number[] | Float32Array): unknown;
    vectorToArray(inputVector: unknown): Float32Array;
    Spectrum(frame: unknown, size?: number): { spectrum: unknown };
    SpectralPeaks(
      spectrum: unknown,
      magnitudeThreshold?: number,
      maxFrequency?: number,
      maxPeaks?: number,
      minFrequency?: number,
      orderBy?: string,
      sampleRate?: number,
    ): { frequencies?: unknown; magnitudes?: unknown };
    HarmonicPeaks(
      frequencies: unknown,
      magnitudes: unknown,
      pitch: number,
      maxHarmonics?: number,
      tolerance?: number,
    ): { harmonicFrequencies?: unknown; harmonicMagnitudes?: unknown };
    shutdown?(): void;
  }

  const EssentiaBundle: {
    EssentiaWASM: unknown;
    Essentia: typeof Essentia;
  };

  export default EssentiaBundle;
}
