import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { FiringOrderEditor } from '@/components/FiringOrderEditor';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import type { EngineConfiguration, HeaderGeometry, ExhaustRouting, IntakeType, RevLimiterType } from '../../../shared/engineTypes';

interface AdvancedBuildPanelProps {
  config: EngineConfiguration;
  onChange: (config: EngineConfiguration) => void;
}

const TOOLTIPS = {
  bore: 'Bore diameter affects the combustion chamber area and influences high-RPM breathing. Larger bore favors high-RPM power.',
  stroke: 'Stroke length affects torque characteristics. Longer stroke produces more low-end torque but limits max RPM.',
  bankAngle: 'The angle between cylinder banks in V and flat engines. Affects firing interval evenness and engine balance.',
  firingOrder: 'The sequence in which cylinders fire. Affects exhaust pulse spacing, vibration, and the characteristic sound of the engine.',
  headerGeometry: 'Equal-length headers produce a smooth, even exhaust tone. Unequal-length creates the distinctive rumble of some boxer and V engines.',
  exhaustRouting: 'Single exhaust merges all cylinders. Dual separates banks. Separate pipes give every collector its own pipe and outlet (set the collector to one per bank in Physics for four pipes on a W or X). Open headers remove all restriction for maximum volume.',
  intakeType: 'ITBs give sharp throttle response and intake howl. Velocity stacks maximize airflow sound. Carbs add a distinctive mechanical character.',
  revLimiter: 'Soft limiters gradually reduce power. Hard fuel cut creates a dramatic stutter. Ignition cut produces pops and bangs.',
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

export function AdvancedBuildPanel({ config, onChange }: AdvancedBuildPanelProps) {
  const advanced = config.advanced || {};
  
  const updateAdvanced = (key: string, value: any) => {
    onChange({
      ...config,
      advanced: { ...advanced, [key]: value },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold font-[Orbitron] text-neon-cyan glow-cyan uppercase tracking-wider">
          Advanced
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-neon-cyan/40 to-transparent" />
      </div>

      {/* Bore */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Bore</label>
            <InfoTooltip text={TOOLTIPS.bore} />
          </div>
          <span className="text-xs font-[Orbitron] text-neon-cyan">{advanced.bore || 90}mm</span>
        </div>
        <Slider
          value={[advanced.bore || 90]}
          onValueChange={([v]) => updateAdvanced('bore', v)}
          min={50}
          max={130}
          step={1}
          tone="cyan"
        />
      </div>

      {/* Stroke */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Stroke</label>
            <InfoTooltip text={TOOLTIPS.stroke} />
          </div>
          <span className="text-xs font-[Orbitron] text-neon-cyan">{advanced.stroke || 86}mm</span>
        </div>
        <Slider
          value={[advanced.stroke || 86]}
          onValueChange={([v]) => updateAdvanced('stroke', v)}
          min={40}
          max={120}
          step={1}
          tone="cyan"
        />
      </div>

      {/* Bank Angle */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Bank Angle</label>
            <InfoTooltip text={TOOLTIPS.bankAngle} />
          </div>
          <span className="text-xs font-[Orbitron] text-neon-cyan">{advanced.bankAngle || 90}°</span>
        </div>
        <Slider
          value={[advanced.bankAngle || 90]}
          onValueChange={([v]) => updateAdvanced('bankAngle', v)}
          min={15}
          max={180}
          step={1}
          tone="cyan"
        />
      </div>

      {/* Firing Order */}
      <FiringOrderEditor config={config} onChange={onChange} />

      {/* Header Geometry */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Headers</label>
          <InfoTooltip text={TOOLTIPS.headerGeometry} />
        </div>
        <Select
          value={advanced.headerGeometry || 'equal-length'}
          onValueChange={(v) => updateAdvanced('headerGeometry', v)}
        >
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="equal-length">Equal Length</SelectItem>
            <SelectItem value="unequal-length">Unequal Length</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Exhaust Routing */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Exhaust Routing</label>
          <InfoTooltip text={TOOLTIPS.exhaustRouting} />
        </div>
        <Select
          value={advanced.exhaustRouting || 'dual'}
          onValueChange={(v) => updateAdvanced('exhaustRouting', v)}
        >
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="single">Single Exhaust</SelectItem>
            <SelectItem value="dual">Dual Exhaust</SelectItem>
            <SelectItem value="separate">Separate Pipes (one per collector)</SelectItem>
            <SelectItem value="open-headers">Open Headers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Exhaust exit */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Exhaust Exit</label>
        <Select
          value={config.physical?.exhaustExit ?? 'rear'}
          onValueChange={(v) => onChange({ ...config, physical: { ...config.physical, exhaustExit: v as 'rear' | 'side' } })}
        >
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="rear">Rear of the vehicle</SelectItem>
            <SelectItem value="side">Side pipes behind the engine</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Intake Type */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Intake Type</label>
          <InfoTooltip text={TOOLTIPS.intakeType} />
        </div>
        <Select
          value={advanced.intakeType || 'single-throttle-body'}
          onValueChange={(v) => updateAdvanced('intakeType', v)}
        >
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="single-throttle-body">Single Throttle Body</SelectItem>
            <SelectItem value="itbs">Individual Throttle Bodies</SelectItem>
            <SelectItem value="carb">Carburetor</SelectItem>
            <SelectItem value="velocity-stacks">Velocity Stacks</SelectItem>
            <SelectItem value="airbox">Airbox</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Rev Limiter */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Rev Limiter</label>
          <InfoTooltip text={TOOLTIPS.revLimiter} />
        </div>
        <Select
          value={advanced.revLimiterType || 'soft'}
          onValueChange={(v) => updateAdvanced('revLimiterType', v)}
        >
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="soft">Soft Limiter</SelectItem>
            <SelectItem value="hard-fuel-cut">Hard Fuel Cut</SelectItem>
            <SelectItem value="hard-ignition-cut">Hard Ignition Cut</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
