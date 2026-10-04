/**
 * Server-side audio rendering for high-fidelity export.
 * Generates WAV audio buffers from engine configurations and uploads to storage.
 */
import type { EngineConfiguration } from "../shared/engineTypes";
import { renderEssPcm } from "../shared/ess/render";
import { updateExportJob } from "./db";
import { storagePut } from "./storage";

export async function renderAndUpload(
  jobId: number,
  config: EngineConfiguration,
  _format: "wav" | "mp3",
  durationSec: number,
): Promise<void> {
  try {
    await updateExportJob(jobId, { status: "processing" });

    const sampleRate = 48000;
    const { left, right } = renderEssPcm(config, { durationSec, sampleRate, normalize: true, program: "sweep" });

    const wavBuffer = encodeWav(left, right, sampleRate, 2);
    const filename = `exports/engine-${config.quick.layout}-${config.quick.cylinderCount}cyl-${jobId}.wav`;
    const { url, key } = await storagePut(filename, Buffer.from(wavBuffer), "audio/wav");

    await updateExportJob(jobId, {
      status: "completed",
      fileUrl: url,
      fileKey: key,
      completedAt: new Date(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await updateExportJob(jobId, {
      status: "failed",
      errorMessage: message,
    });
    throw error;
  }
}

function encodeWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  numChannels: number,
): ArrayBuffer {
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const length = left.length;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sampleL = Math.max(-1, Math.min(1, left[i]));
    view.setInt16(offset, sampleL < 0 ? sampleL * 0x8000 : sampleL * 0x7fff, true);
    offset += 2;

    const sampleR = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, sampleR < 0 ? sampleR * 0x8000 : sampleR * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}
