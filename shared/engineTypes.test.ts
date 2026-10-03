import { describe, expect, it } from "vitest";
import {
  validateFiringOrder,
  getDefaultFiringOrder,
  DEFAULT_ENGINE_CONFIG,
  FACTORY_PRESETS,
  normalizeSoundProfile,
  SOUND_PROFILE_HISTORY,
} from "./engineTypes";

describe("validateFiringOrder", () => {
  it("accepts a valid 4-cylinder firing order", () => {
    const result = validateFiringOrder([1, 3, 4, 2], 4);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a valid 8-cylinder firing order", () => {
    const result = validateFiringOrder([1, 8, 4, 3, 6, 5, 7, 2], 8);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects wrong length", () => {
    const result = validateFiringOrder([1, 3, 4], 4);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exactly 4 entries");
  });

  it("rejects out-of-range cylinders", () => {
    const result = validateFiringOrder([1, 3, 5, 2], 4);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("out of range");
  });

  it("rejects duplicate cylinders", () => {
    const result = validateFiringOrder([1, 3, 3, 2], 4);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("more than once"))).toBe(true);
  });

  it("reports missing cylinders", () => {
    const result = validateFiringOrder([1, 2, 3, 5], 4);
    expect(result.valid).toBe(false);
  });
});

describe("getDefaultFiringOrder", () => {
  it("returns correct inline-4 firing order", () => {
    const order = getDefaultFiringOrder("inline", 4, "even-fire");
    expect(order).toEqual([1, 3, 4, 2]);
  });

  it("returns correct inline-6 firing order", () => {
    const order = getDefaultFiringOrder("inline", 6, "even-fire");
    expect(order).toEqual([1, 5, 3, 6, 2, 4]);
  });

  it("returns correct cross-plane V8 firing order", () => {
    const order = getDefaultFiringOrder("v", 8, "cross-plane");
    expect(order).toEqual([1, 8, 4, 3, 6, 5, 7, 2]);
  });

  it("returns correct flat-plane V8 firing order", () => {
    const order = getDefaultFiringOrder("v", 8, "flat-plane");
    expect(order).toEqual([1, 5, 4, 8, 3, 7, 2, 6]);
  });

  it("returns sequential fallback for unknown configs", () => {
    const order = getDefaultFiringOrder("w", 16, "even-fire");
    expect(order).toHaveLength(16);
    expect(order[0]).toBe(1);
    expect(order[15]).toBe(16);
  });
});

describe("DEFAULT_ENGINE_CONFIG", () => {
  it("has valid quick build defaults", () => {
    expect(DEFAULT_ENGINE_CONFIG.quick.layout).toBe("v");
    expect(DEFAULT_ENGINE_CONFIG.quick.cylinderCount).toBe(8);
    expect(DEFAULT_ENGINE_CONFIG.quick.displacement).toBe(5.0);
    expect(DEFAULT_ENGINE_CONFIG.quick.crankshaft).toBe("cross-plane");
    expect(DEFAULT_ENGINE_CONFIG.quick.aspiration).toBe("na");
    expect(DEFAULT_ENGINE_CONFIG.quick.redline).toBeGreaterThan(0);
    expect(DEFAULT_ENGINE_CONFIG.soundProfile).toBe("v16");
  });

  it("has valid forced induction defaults", () => {
    expect(DEFAULT_ENGINE_CONFIG.forcedInduction.type).toBe("na");
  });
});

describe("sound profile history", () => {
  it("keeps versioned profiles while accepting old saved aliases", () => {
    expect(SOUND_PROFILE_HISTORY.map((profile) => profile.value)).toEqual(["v16", "v15", "v14", "v13", "v12", "v11", "v10", "v9", "v8", "v0"]);
    expect(normalizeSoundProfile("clarity")).toBe("v9");
    expect(normalizeSoundProfile("clean")).toBe("v8");
    expect(normalizeSoundProfile("baseline")).toBe("v0");
    expect(normalizeSoundProfile(undefined)).toBe("v16");
  });
});

describe("FACTORY_PRESETS", () => {
  it("has at least 5 presets", () => {
    expect(Object.keys(FACTORY_PRESETS).length).toBeGreaterThanOrEqual(5);
  });

  it("each preset has required fields", () => {
    for (const [key, preset] of Object.entries(FACTORY_PRESETS)) {
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.config.quick).toBeDefined();
      expect(preset.config.quick.layout).toBeTruthy();
      expect(preset.config.quick.cylinderCount).toBeGreaterThan(0);
      expect(preset.config.quick.redline).toBeGreaterThan(0);
      expect(preset.config.forcedInduction).toBeDefined();
    }
  });

  it("turbo presets have turbo config", () => {
    const turboPreset = FACTORY_PRESETS["inline-4-turbo"];
    expect(turboPreset).toBeDefined();
    expect(turboPreset.config.forcedInduction.type).toBe("turbo");
    expect(turboPreset.config.forcedInduction.turboSize).toBeDefined();
    expect(turboPreset.config.forcedInduction.turboSpoolThreshold).toBe(2000);
    expect(turboPreset.config.forcedInduction.maxBoost).toBeGreaterThan(0);
  });

  it("supercharged presets have supercharger config", () => {
    const scPreset = FACTORY_PRESETS["supercharged-v8"];
    expect(scPreset).toBeDefined();
    expect(scPreset.config.forcedInduction.type).toBe("supercharged");
    expect(scPreset.config.forcedInduction.superchargerType).toBeDefined();
  });
});
