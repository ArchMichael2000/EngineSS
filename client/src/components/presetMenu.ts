/**
 * Pure model of the preset menu: groups, option values (the preset key, "ref:"-prefixed for
 * reference engines) and the labels shown. Kept free of React so it can be unit tested.
 */
import { FACTORY_PRESETS, SABER_PRESETS } from "../../../shared/engineTypes";
import type { EngineConfiguration } from "../../../shared/engineTypes";
import { REFERENCE_ENGINES } from "../../../shared/ess/reference/engines";

export const REF_PREFIX = "ref:";

export interface PresetOption {
  /** Option value: the preset key, "ref:"-prefixed for reference engines. */
  value: string;
  shortName: string;
  name: string;
  /** Screen-reader name: the full name, plus the short name where full names repeat (Saber variants). */
  accessibleName: string;
  description: string;
  config: EngineConfiguration;
}

export interface PresetGroup {
  id: string;
  label: string;
  options: PresetOption[];
}

type Entry = { name: string; shortName?: string; description: string; config: EngineConfiguration };

function toOptions(table: Record<string, Entry>, prefix = ""): PresetOption[] {
  return Object.entries(table).map(([key, p]) => ({
    value: prefix + key,
    shortName: p.shortName || p.name,
    name: p.name,
    accessibleName: p.name,
    description: p.description,
    config: p.config,
  }));
}

export const PRESET_GROUPS: PresetGroup[] = [
  { id: "saber", label: "Saber Cross-Four (X layout)", options: toOptions(SABER_PRESETS) },
  { id: "reference", label: "Reference engines (v16 physical core)", options: toOptions(REFERENCE_ENGINES, REF_PREFIX) },
  { id: "factory", label: "Factory presets", options: toOptions(FACTORY_PRESETS) },
];

/** Every option in display order (the order keyboard navigation follows). */
export const PRESET_OPTIONS: PresetOption[] = PRESET_GROUPS.flatMap((g) => g.options);

for (const option of PRESET_OPTIONS) {
  if (PRESET_OPTIONS.some((o) => o !== option && o.name === option.name)) option.accessibleName = `${option.name}, ${option.shortName}`;
}

/** Looks a preset up by option value, exactly as the old native select did. */
export function findPreset(value: string): PresetOption | undefined {
  return PRESET_OPTIONS.find((o) => o.value === value);
}

/**
 * Type-ahead: the next option (after `from`, wrapping) whose short name starts with `query`.
 * A query of one repeated character cycles through the matches for that character, like a native select.
 */
export function typeAheadMatch(options: readonly PresetOption[], query: string, from: number): number {
  const q = query.toLowerCase();
  if (!q || !options.length) return -1;
  const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0] : q;
  // A fresh multi-character query may still match the current option; a single key moves on.
  const start = needle.length > 1 ? from : from + 1;
  for (let i = 0; i < options.length; i++) {
    const idx = (((start + i) % options.length) + options.length) % options.length;
    if (options[idx].shortName.toLowerCase().startsWith(needle)) return idx;
  }
  return -1;
}
