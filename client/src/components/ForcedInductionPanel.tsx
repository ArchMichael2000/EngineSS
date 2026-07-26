import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import type { EngineConfiguration, TurboSize, SuperchargerType } from '../../../shared/engineTypes';

interface ForcedInductionPanelProps {
  config: EngineConfiguration;
  onChange: (config: EngineConfiguration) => void;
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3.5 h-3.5 text-neon-cyan/60 hover:text-neon-cyan cursor-help transition-colors" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64 bg-dark-elevated border-hud-line text-foreground text-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function ForcedInductionPanel({ config, onChange }: ForcedInductionPanelProps) {
  const fi = config.forcedInduction;

  const updateFI = (updates: Partial<typeof fi>) => {
    onChange({
      ...config,
      forcedInduction: { ...fi, ...updates },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold font-[Orbitron] text-neon-purple glow-purple uppercase tracking-wider">
          Forced Induction
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-neon-purple/40 to-transparent" />
      </div>

      {/* Current aspiration type display */}
      <div className="bg-dark-bg/50 rounded p-3 border border-hud-line/20">
        <div className="text-[10px] font-[Rajdhani] text-muted-foreground uppercase tracking-wider mb-1">Current Mode</div>
        <div className="text-sm font-[Orbitron] font-semibold text-neon-purple">
          {fi.type === 'na' ? 'Naturally Aspirated' : fi.type === 'turbo' ? 'Turbocharged' : 'Supercharged'}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 font-[Rajdhani]">
          Change aspiration type in Quick Build tab
        </p>
      </div>

      {/* Turbo Settings */}
      {fi.type === 'turbo' && (
        <div className="space-y-4">
          {/* Turbo Size */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Turbo Size</label>
              <InfoTooltip text="Small turbos spool quickly but make less peak power. Large turbos have more lag but deliver massive top-end boost." />
            </div>
            <Select value={fi.turboSize || 'balanced'} onValueChange={(v) => updateFI({ turboSize: v as TurboSize })}>
              <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-dark-elevated border-hud-line">
                <SelectItem value="small">Small (Quick Spool)</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="large">Large (High Output)</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Spool Threshold */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Spool Threshold</label>
                <InfoTooltip text="The RPM at which the turbo begins to build boost. Lower threshold means earlier boost onset." />
              </div>
              <span className="text-xs font-[Orbitron] text-neon-purple">{fi.turboSpoolThreshold || 2000} RPM</span>
            </div>
            <Slider
              value={[fi.turboSpoolThreshold || 2000]}
              onValueChange={([v]) => updateFI({ turboSpoolThreshold: v })}
              min={1500}
              max={5500}
              step={100}
              className="[&_[role=slider]]:bg-neon-purple [&_[role=slider]]:border-neon-purple"
            />
          </div>

          {/* Max Boost */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Max Boost</label>
                <InfoTooltip text="Peak boost pressure in PSI. Higher boost means more power but also more turbo sound intensity." />
              </div>
              <span className="text-xs font-[Orbitron] text-neon-purple">{fi.maxBoost || 15} PSI</span>
            </div>
            <Slider
              value={[fi.maxBoost || 15]}
              onValueChange={([v]) => updateFI({ maxBoost: v })}
              min={5}
              max={40}
              step={1}
              className="[&_[role=slider]]:bg-neon-purple [&_[role=slider]]:border-neon-purple"
            />
          </div>

          {/* BOV Toggle */}
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Blow-Off Valve</Label>
              <InfoTooltip text="The BOV releases pressurized air when the throttle closes, creating the iconic 'psshh' sound." />
            </div>
            <Switch
              checked={fi.bovEnabled ?? true}
              onCheckedChange={(v) => updateFI({ bovEnabled: v })}
              className="data-[state=checked]:bg-neon-purple"
            />
          </div>

          {/* Wastegate Toggle */}
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Wastegate</Label>
              <InfoTooltip text="The wastegate diverts exhaust gas to control boost. External wastegates produce a distinctive flutter/scream." />
            </div>
            <Switch
              checked={fi.wastegateEnabled ?? true}
              onCheckedChange={(v) => updateFI({ wastegateEnabled: v })}
              className="data-[state=checked]:bg-neon-purple"
            />
          </div>
        </div>
      )}

      {/* Supercharger Settings */}
      {fi.type === 'supercharged' && (
        <div className="space-y-4">
          {/* Supercharger Type */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Type</label>
              <InfoTooltip text="Roots blowers produce a deep whine. Twin-screw is more efficient with a higher-pitched sound. Centrifugal sounds like a turbo but with linear response." />
            </div>
            <Select
              value={fi.superchargerType || 'roots'}
              onValueChange={(v) => updateFI({ superchargerType: v as SuperchargerType })}
            >
              <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-dark-elevated border-hud-line">
                <SelectItem value="roots">Roots (Classic Blower)</SelectItem>
                <SelectItem value="twin-screw">Twin-Screw</SelectItem>
                <SelectItem value="centrifugal">Centrifugal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Boost Level */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Boost</label>
              </div>
              <span className="text-xs font-[Orbitron] text-neon-purple">{fi.superchargerBoost || 10} PSI</span>
            </div>
            <Slider
              value={[fi.superchargerBoost || 10]}
              onValueChange={([v]) => updateFI({ superchargerBoost: v })}
              min={3}
              max={25}
              step={1}
              className="[&_[role=slider]]:bg-neon-purple [&_[role=slider]]:border-neon-purple"
            />
          </div>

          {/* Whine Intensity */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Whine Intensity</label>
                <InfoTooltip text="How prominent the supercharger whine is in the overall engine sound mix." />
              </div>
              <span className="text-xs font-[Orbitron] text-neon-purple">{Math.round((fi.whineIntensity || 0.6) * 100)}%</span>
            </div>
            <Slider
              value={[(fi.whineIntensity || 0.6) * 100]}
              onValueChange={([v]) => updateFI({ whineIntensity: v / 100 })}
              min={0}
              max={100}
              step={5}
              className="[&_[role=slider]]:bg-neon-purple [&_[role=slider]]:border-neon-purple"
            />
          </div>
        </div>
      )}

      {/* NA Info */}
      {fi.type === 'na' && (
        <div className="text-center py-6 text-muted-foreground">
          <p className="text-xs font-[Rajdhani]">
            Engine is naturally aspirated. Switch to Turbo or Supercharged in the Quick Build tab to configure forced induction.
          </p>
        </div>
      )}
    </div>
  );
}
