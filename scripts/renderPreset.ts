/**
 * Render any preset through the live signal chain (core + output leveler) to a stereo WAV.
 *
 *   npx vite-node scripts/renderPreset.ts -- <presetKey> <program> <seconds> <out.wav> [perspective]
 *
 * presetKey: a reference engine (gm-ls3 …), a Saber preset (saber-sb8 …) or a factory preset.
 * program:   sweep | steady | free-rev (see shared/ess/render.ts). PATCH='{json}' deep-merges into the config.
 */
import { writeFileSync } from "node:fs";
import { renderEssPcm } from "../shared/ess/render";
import type { EssRenderProgram } from "../shared/ess/render";
import { REFERENCE_ENGINES } from "../shared/ess/reference/engines";
import { FACTORY_PRESETS, SABER_PRESETS } from "../shared/engineTypes";
import type { Perspective } from "../shared/ess/observer";

const [key, program, seconds, out, perspective] = process.argv.slice(2).filter((a) => a !== "--");
const preset = REFERENCE_ENGINES[key] ?? SABER_PRESETS[key] ?? FACTORY_PRESETS[key];
if (!preset) throw new Error(`unknown preset ${key}`);
function merge(base: any, patch: any): any {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const result: any = { ...base };
  for (const [k, v] of Object.entries(patch)) result[k] = merge(base?.[k], v);
  return result;
}
const config = merge({ ...preset.config, seed: 11 }, process.env.PATCH ? JSON.parse(process.env.PATCH) : {});
const { left, right, sampleRate } = renderEssPcm(config, { durationSec: Number(seconds), program: program as EssRenderProgram, perspective: (perspective as Perspective) ?? "exterior-rear", prerollSec: 2.5 });
const n = left.length;
const buf = Buffer.alloc(44 + n * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
const clip = (x: number) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
for (let i = 0; i < n; i++) {
  buf.writeInt16LE(clip(left[i]), 44 + i * 4);
  buf.writeInt16LE(clip(right[i]), 46 + i * 4);
}
writeFileSync(out, buf);
console.log(`wrote ${out}: ${preset.name}, ${program}, ${seconds} s`);
