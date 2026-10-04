/**
 * Web Worker for offline export: runs shared/ess/render.ts off the main thread so the page stays
 * responsive while a clip renders (a 10 s clip of a large engine takes several seconds).
 */
import { renderEssPcm } from "../../../../shared/ess/render";
import type { EssRenderOptions } from "../../../../shared/ess/render";
import type { EngineConfiguration } from "../../../../shared/engineTypes";

export type RenderRequest = { config: EngineConfiguration; options: EssRenderOptions };
export type RenderResponse = { ok: true; left: Float32Array; right: Float32Array } | { ok: false; message: string };

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  try {
    const { left, right } = renderEssPcm(event.data.config, event.data.options);
    (self as unknown as Worker).postMessage({ ok: true, left, right } satisfies RenderResponse, [left.buffer, right.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) } satisfies RenderResponse);
  }
};
