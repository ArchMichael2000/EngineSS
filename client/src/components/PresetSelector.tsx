import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FACTORY_PRESETS } from '../../../shared/engineTypes';
import type { EngineConfiguration } from '../../../shared/engineTypes';
import { REFERENCE_ENGINES } from '../../../shared/ess/reference/engines';

interface PresetSelectorProps {
  onSelect: (config: EngineConfiguration) => void;
}

const REF_PREFIX = 'ref:';

export function PresetSelector({ onSelect }: PresetSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
          Presets
        </h3>
        <div className="flex-1 h-px bg-hud-line/30" />
      </div>
      <Select
        onValueChange={(key) => {
          const preset = key.startsWith(REF_PREFIX) ? REFERENCE_ENGINES[key.slice(REF_PREFIX.length)] : FACTORY_PRESETS[key];
          if (preset) {
            onSelect(preset.config);
          }
        }}
      >
        <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
          <SelectValue placeholder="Load a preset..." />
        </SelectTrigger>
        <SelectContent className="bg-dark-elevated border-hud-line max-h-[420px]">
          <SelectGroup label="Reference engines (v16 physical core)">
            {Object.entries(REFERENCE_ENGINES).map(([key, ref]) => (
              <SelectItem key={key} value={REF_PREFIX + key} className="font-[Rajdhani]">
                <div className="flex flex-col">
                  <span className="text-sm">{ref.name}</span>
                  <span className="text-xs text-muted-foreground">{ref.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup label="Factory presets">
            {Object.entries(FACTORY_PRESETS).map(([key, preset]) => (
              <SelectItem key={key} value={key} className="font-[Rajdhani]">
                <div className="flex flex-col">
                  <span className="text-sm">{preset.name}</span>
                  <span className="text-xs text-muted-foreground">{preset.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
