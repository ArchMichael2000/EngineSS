import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FACTORY_PRESETS } from '../../../shared/engineTypes';
import type { EngineConfiguration } from '../../../shared/engineTypes';

interface PresetSelectorProps {
  onSelect: (config: EngineConfiguration) => void;
}

export function PresetSelector({ onSelect }: PresetSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
          Factory Presets
        </h3>
        <div className="flex-1 h-px bg-hud-line/30" />
      </div>
      <Select
        onValueChange={(key) => {
          const preset = FACTORY_PRESETS[key];
          if (preset) {
            onSelect(preset.config);
          }
        }}
      >
        <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
          <SelectValue placeholder="Load a preset..." />
        </SelectTrigger>
        <SelectContent className="bg-dark-elevated border-hud-line">
          {Object.entries(FACTORY_PRESETS).map(([key, preset]) => (
            <SelectItem key={key} value={key} className="font-[Rajdhani]">
              <div className="flex flex-col">
                <span className="text-sm">{preset.name}</span>
                <span className="text-xs text-muted-foreground">{preset.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
