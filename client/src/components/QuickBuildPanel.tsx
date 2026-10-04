import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import type { EngineConfiguration, EngineLayout, CrankshaftType, AspirationType, ExhaustCharacter, IdleCharacter, EngineCycleType, FuelType } from '../../../shared/engineTypes';

interface QuickBuildPanelProps {
  config: EngineConfiguration;
  onChange: (config: EngineConfiguration) => void;
}

const TOOLTIPS = {
  layout: 'Engine layout determines how cylinders are arranged. V-engines have two banks at an angle, inline engines have all cylinders in a row, flat engines have opposing banks at 180°.',
  cylinderCount: 'More cylinders add pulse density and smoothness. Perceived pitch and depth depend on displacement, crank layout, firing order, intake, and exhaust geometry.',
  displacement: 'Larger displacement produces deeper, more powerful exhaust tones with more low-frequency energy.',
  crankshaft: 'Cross-plane creates the classic V8 burble with uneven exhaust pulses. Flat-plane produces an even, high-pitched scream. Odd-fire creates an asymmetric, distinctive rhythm.',
  engineType: 'Working cycle and combustion. Diesels are compression-ignited and unthrottled: load is set by fuel quantity, and the rapid premixed burn after the ignition delay is the diesel clatter (softened by common-rail pilot injection). Two-strokes fire every revolution through piston-controlled ports; the crankcase pumps the charge and a tuned expansion chamber makes the power band. Wankel rotaries fire each rotor once per e-shaft revolution through ports the apex seals sweep open; idle character selects the porting (stock side ports → street → bridgeport → peripheral port).',
  aspiration: 'Naturally aspirated engines breathe freely. Turbochargers add spool whine and blow-off sounds. Superchargers add a constant mechanical whine proportional to RPM.',
  exhaustCharacter: 'Stock is quiet and muffled. Sport adds more mid-range presence. Race is loud with minimal restriction. Straight-pipe removes all muffling.',
  idleCharacter: 'Smooth idles are steady and even. Lumpy idles have slight variation. Aggressive idles have pronounced unevenness. Lopey idles have dramatic cam-driven rhythm.',
  redline: 'The maximum safe RPM. Higher redlines allow more rev range but change the engine character at the top end.',
};

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

export function QuickBuildPanel({ config, onChange }: QuickBuildPanelProps) {
  const updateQuick = (key: string, value: any) => {
    onChange({
      ...config,
      quick: { ...config.quick, [key]: value },
      // Auto-update forced induction when aspiration changes
      ...(key === 'aspiration' && {
        forcedInduction: {
          type: value as AspirationType,
          ...(value === 'turbo' && {
            turboSize: 'balanced' as const,
            turboSpoolThreshold: 2000,
            maxBoost: 15,
            bovEnabled: true,
            wastegateEnabled: true,
          }),
          ...(value === 'supercharged' && {
            superchargerType: 'roots' as const,
            superchargerBoost: 10,
            whineIntensity: 0.6,
          }),
        },
      }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold font-[Orbitron] text-neon-pink glow-pink uppercase tracking-wider">
          Quick Build
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-neon-pink/40 to-transparent" />
      </div>

      {/* Engine Layout */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Layout</label>
          <InfoTooltip text={TOOLTIPS.layout} />
        </div>
        <Select value={config.quick.layout} onValueChange={(v) => updateQuick('layout', v)}>
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="inline">Inline</SelectItem>
            <SelectItem value="v">V-Engine</SelectItem>
            <SelectItem value="flat">Flat / Boxer</SelectItem>
            <SelectItem value="w">W-Engine</SelectItem>
            <SelectItem value="radial">Radial</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cylinder Count */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">{config.quick.cycle === 'rotary' ? 'Rotors' : 'Cylinders'}</label>
            <InfoTooltip text={TOOLTIPS.cylinderCount} />
          </div>
          <span className="text-xs font-[Orbitron] text-neon-cyan">{config.quick.cylinderCount}</span>
        </div>
        <Slider
          value={[config.quick.cylinderCount]}
          onValueChange={([v]) => updateQuick('cylinderCount', v)}
          min={1}
          max={config.quick.cycle === 'rotary' ? 4 : 16}
          step={1}
          className="[&_[role=slider]]:bg-neon-cyan [&_[role=slider]]:border-neon-cyan [&_[role=slider]]:shadow-[0_0_6px_oklch(0.75_0.18_195/0.5)]"
        />
      </div>

      {/* Displacement */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Displacement</label>
            <InfoTooltip text={TOOLTIPS.displacement} />
          </div>
          <span className="text-xs font-[Orbitron] text-neon-cyan">{config.quick.displacement.toFixed(1)}L</span>
        </div>
        <Slider
          value={[config.quick.displacement * 10]}
          onValueChange={([v]) => updateQuick('displacement', v / 10)}
          min={5}
          max={80}
          step={1}
          className="[&_[role=slider]]:bg-neon-cyan [&_[role=slider]]:border-neon-cyan [&_[role=slider]]:shadow-[0_0_6px_oklch(0.75_0.18_195/0.5)]"
        />
      </div>

      {/* Crankshaft */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Crankshaft</label>
          <InfoTooltip text={TOOLTIPS.crankshaft} />
        </div>
        <Select value={config.quick.crankshaft} onValueChange={(v) => updateQuick('crankshaft', v)}>
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="cross-plane">Cross-Plane</SelectItem>
            <SelectItem value="flat-plane">Flat-Plane</SelectItem>
            <SelectItem value="even-fire">Even-Fire</SelectItem>
            <SelectItem value="odd-fire">Odd-Fire</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Engine type (cycle + combustion) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Engine Type</label>
          <InfoTooltip text={TOOLTIPS.engineType} />
        </div>
        <Select
          value={`${config.quick.cycle ?? 'four-stroke'}:${config.quick.fuel ?? 'gasoline'}`}
          onValueChange={(v) => {
            const [cycle, fuel] = v.split(':');
            onChange({
              ...config,
              quick: {
                ...config.quick,
                cycle: cycle as EngineCycleType,
                fuel: fuel as FuelType,
                // Diesels are governed far lower than spark engines.
                ...(fuel === 'diesel' && config.quick.redline > 5200 && { redline: 4800 }),
                // Rotary: the count is rotors (displacement = rotors × one chamber, Mazda convention).
                ...(cycle === 'rotary' && config.quick.cylinderCount > 4 && { cylinderCount: 2, displacement: 1.3 }),
              },
            });
          }}
        >
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="four-stroke:gasoline">Four-Stroke Gasoline</SelectItem>
            <SelectItem value="four-stroke:diesel">Four-Stroke Diesel</SelectItem>
            <SelectItem value="two-stroke:gasoline">Two-Stroke (crankcase-scavenged)</SelectItem>
            <SelectItem value="rotary:gasoline">Wankel Rotary</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Aspiration */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Aspiration</label>
          <InfoTooltip text={TOOLTIPS.aspiration} />
        </div>
        <Select value={config.quick.aspiration} onValueChange={(v) => updateQuick('aspiration', v)}>
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="na">Naturally Aspirated</SelectItem>
            <SelectItem value="turbo">Turbocharged</SelectItem>
            <SelectItem value="supercharged">Supercharged</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Exhaust Character */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Exhaust</label>
          <InfoTooltip text={TOOLTIPS.exhaustCharacter} />
        </div>
        <Select value={config.quick.exhaustCharacter} onValueChange={(v) => updateQuick('exhaustCharacter', v)}>
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="stock">Stock</SelectItem>
            <SelectItem value="sport">Sport</SelectItem>
            <SelectItem value="race">Race</SelectItem>
            <SelectItem value="straight-pipe">Straight Pipe</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Idle Character */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Idle</label>
          <InfoTooltip text={TOOLTIPS.idleCharacter} />
        </div>
        <Select value={config.quick.idleCharacter} onValueChange={(v) => updateQuick('idleCharacter', v)}>
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="smooth">Smooth</SelectItem>
            <SelectItem value="lumpy">Lumpy</SelectItem>
            <SelectItem value="aggressive">Aggressive</SelectItem>
            <SelectItem value="lopey">Lopey</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Redline */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Redline</label>
            <InfoTooltip text={TOOLTIPS.redline} />
          </div>
          <span className="text-xs font-[Orbitron] text-neon-pink">{config.quick.redline} RPM</span>
        </div>
        <Slider
          value={[config.quick.redline]}
          onValueChange={([v]) => updateQuick('redline', v)}
          min={4000}
          max={12000}
          step={100}
          className="[&_[role=slider]]:bg-neon-pink [&_[role=slider]]:border-neon-pink [&_[role=slider]]:shadow-[0_0_6px_oklch(0.72_0.25_330/0.5)]"
        />
      </div>
    </div>
  );
}
