import { describe, expect, it } from "vitest";
import { FACTORY_PRESETS } from "../shared/engineTypes";
import { resolveLiveOutputGain, resolveRealtimeAudioMixProfile } from "./realtimeAudioMix";

describe("realtime audio mix profile", () => {
  it("makes current and saved clarity models primarily direct to avoid filtered live playback coloration", () => {
    const clarity = resolveRealtimeAudioMixProfile("v15");

    expect(clarity.dryExhaustGain).toBeGreaterThan(0.95);
    expect(clarity.filteredExhaustGain).toBe(0);
    expect(clarity.filteredIntakeGain).toBe(0);
    expect(resolveRealtimeAudioMixProfile("v9")).toEqual(clarity);
    expect(resolveRealtimeAudioMixProfile("v10")).toEqual(clarity);
    expect(resolveRealtimeAudioMixProfile("v11")).toEqual(clarity);
    expect(resolveRealtimeAudioMixProfile("v12")).toEqual(clarity);
    expect(resolveRealtimeAudioMixProfile("v13")).toEqual(clarity);
    expect(resolveRealtimeAudioMixProfile("v14")).toEqual(clarity);
  });

  it("keeps current compressor nearly transparent for sharper live playback", () => {
    const clarity = resolveRealtimeAudioMixProfile("v15");

    expect(clarity.compressorThresholdDb).toBeGreaterThan(-1);
    expect(clarity.compressorRatio).toBeLessThan(1.12);
    expect(clarity.compressorAttackSec).toBeGreaterThan(0.012);
  });

  it("disables legacy forced-induction oscillators for current worklet playback", () => {
    const clarity = resolveRealtimeAudioMixProfile("v15");

    expect(clarity.legacyForcedInductionOscillatorGain).toBe(0);
  });

  it("preserves the saved clean depth mix as the filtered comparison path", () => {
    const clean = resolveRealtimeAudioMixProfile("v8");

    expect(clean.filteredExhaustGain).toBeGreaterThan(clean.dryExhaustGain * 8);
    expect(clean.filteredIntakeGain).toBeGreaterThan(clean.dryExhaustGain);
    expect(clean.compressorRatio).toBeGreaterThan(2);
    expect(clean.legacyForcedInductionOscillatorGain).toBe(1);
  });

  it("defaults missing profile values to clarity", () => {
    expect(resolveRealtimeAudioMixProfile(undefined)).toEqual(resolveRealtimeAudioMixProfile("v15"));
  });

  it("raises live output gain for smaller and smoother engine families", () => {
    const crossPlane = resolveLiveOutputGain(FACTORY_PRESETS["v8-crossplane"].config);
    const inlineSix = resolveLiveOutputGain(FACTORY_PRESETS["inline-6"].config);
    const turboFour = resolveLiveOutputGain(FACTORY_PRESETS["inline-4-turbo"].config);

    expect(inlineSix).toBeGreaterThan(crossPlane);
    expect(turboFour).toBeGreaterThan(crossPlane);
    expect(turboFour).toBeLessThanOrEqual(1);
  });

  it("keeps large live output families below clipping-prone gain", () => {
    const v12 = resolveLiveOutputGain(FACTORY_PRESETS["v12"].config);
    const superchargedV8 = resolveLiveOutputGain(FACTORY_PRESETS["supercharged-v8"].config);

    expect(v12).toBeLessThanOrEqual(0.88);
    expect(superchargedV8).toBeLessThanOrEqual(0.88);
    expect(v12).toBeGreaterThanOrEqual(0.72);
  });

  it("does not lower live output only because cylinder count increases", () => {
    const v8 = resolveLiveOutputGain(FACTORY_PRESETS["v8-crossplane"].config);
    const v10 = resolveLiveOutputGain(FACTORY_PRESETS["v10"].config);
    const v12 = resolveLiveOutputGain(FACTORY_PRESETS["v12"].config);

    expect(v10).toBeGreaterThan(v8 * 0.88);
    expect(v12).toBeGreaterThan(v8 * 0.88);
  });
});
