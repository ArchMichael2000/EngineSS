import { describe, expect, it } from "vitest";
import { FACTORY_PRESETS, SABER_PRESETS } from "../../../shared/engineTypes";
import { REFERENCE_ENGINES } from "../../../shared/ess/reference/engines";
import { PRESET_GROUPS, PRESET_OPTIONS, REF_PREFIX, findPreset, typeAheadMatch } from "./presetMenu";

const tables = { SABER_PRESETS, REFERENCE_ENGINES, FACTORY_PRESETS } as Record<string, Record<string, { name: string; shortName?: string }>>;

describe("preset short names", () => {
  it("every preset has a non-empty shortName no longer than its name", () => {
    for (const [table, entries] of Object.entries(tables)) {
      for (const [key, p] of Object.entries(entries)) {
        expect(p.shortName?.trim(), `${table}.${key}`).toBeTruthy();
        expect(p.shortName!.length, `${table}.${key}: "${p.shortName}"`).toBeLessThanOrEqual(p.name.length);
      }
    }
  });

  it("short names are unique across the whole menu", () => {
    const names = PRESET_OPTIONS.map((o) => o.shortName.toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("screen-reader names are unique and start with the full name", () => {
    const names = PRESET_OPTIONS.map((o) => o.accessibleName);
    expect(new Set(names).size).toBe(names.length);
    for (const o of PRESET_OPTIONS) expect(o.accessibleName.startsWith(o.name)).toBe(true);
  });
});

describe("preset menu model", () => {
  it("keeps every key and value: plain keys, ref:-prefixed reference engines", () => {
    expect(Object.keys(SABER_PRESETS)).toHaveLength(9);
    expect(Object.keys(REFERENCE_ENGINES)).toHaveLength(32);
    expect(Object.keys(FACTORY_PRESETS)).toHaveLength(8);
    expect(PRESET_OPTIONS).toHaveLength(9 + 32 + 8);
    expect(PRESET_GROUPS.map((g) => g.options.map((o) => o.value))).toEqual([
      Object.keys(SABER_PRESETS),
      Object.keys(REFERENCE_ENGINES).map((k) => REF_PREFIX + k),
      Object.keys(FACTORY_PRESETS),
    ]);
    expect(new Set(PRESET_OPTIONS.map((o) => o.value)).size).toBe(PRESET_OPTIONS.length);
  });

  it("selecting a value yields the same config object as the source table", () => {
    expect(findPreset("ref:gm-ls3")?.config).toBe(REFERENCE_ENGINES["gm-ls3"].config);
    expect(findPreset("saber-sb8")?.config).toBe(SABER_PRESETS["saber-sb8"].config);
    expect(findPreset("v12")?.config).toBe(FACTORY_PRESETS["v12"].config);
    expect(findPreset("ref:v12")).toBeUndefined();
  });

  it("type-ahead matches short names, cycles on a repeated key and wraps", () => {
    const opts = PRESET_OPTIONS;
    const ls3 = opts.findIndex((o) => o.value === "ref:gm-ls3");
    expect(typeAheadMatch(opts, "ls3", 0)).toBe(ls3);
    const first = typeAheadMatch(opts, "y", -1);
    expect(opts[first].shortName.startsWith("Yamaha")).toBe(true);
    const second = typeAheadMatch(opts, "yy", first);
    expect(second).toBeGreaterThan(first);
    expect(opts[second].shortName[0]).toBe("Y");
    expect(typeAheadMatch(opts, "s", opts.length - 1)).toBe(0); // wraps to Saber SB4
    expect(typeAheadMatch(opts, "zzzz-none", 0)).toBe(-1);
  });
});
