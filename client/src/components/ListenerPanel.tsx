import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import type { ListenerPerspective } from '../../../shared/engineTypes';
import type { StemGains } from '../../../shared/ess/engine';
import { PERSPECTIVES } from '../../../shared/ess/observer';

interface ListenerPanelProps {
  perspective: ListenerPerspective;
  onPerspectiveChange: (perspective: ListenerPerspective) => void;
  onStemsChange: (stems: Partial<StemGains>) => void;
}

const STEMS: Array<{ key: keyof StemGains; label: string; hint: string }> = [
  { key: 'exhaust', label: 'Exhaust radiation', hint: 'Pressure waves leaving the tailpipe(s)' },
  { key: 'exhaustJet', label: 'Outlet jet', hint: 'Turbulent mixing of the exhaust jet (U⁸ law)' },
  { key: 'valveJet', label: 'Valve-throat jet', hint: 'Blowdown turbulence injected at the exhaust ports' },
  { key: 'intake', label: 'Induction', hint: 'Intake mouth / bellmouths radiation' },
  { key: 'structure', label: 'Structure-borne', hint: 'Block and head modes: combustion, piston slap, valve seating' },
  { key: 'accessory', label: 'Boost hardware', hint: 'Compressor, BOV, blower whine' },
];

/** v16 listener placement and stem mixer. Stems change only what reaches the microphone, never the physics. */
export function ListenerPanel({ perspective, onPerspectiveChange, onStemsChange }: ListenerPanelProps) {
  const [gains, setGains] = useState<Record<string, number>>(() => Object.fromEntries(STEMS.map((s) => [s.key, 100])));
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-[Rajdhani] text-muted-foreground uppercase tracking-wide">Listener</h4>
      <Select value={perspective} onValueChange={(v) => onPerspectiveChange(v as ListenerPerspective)}>
        <SelectTrigger className="h-8 text-xs bg-dark-surface border-hud-line">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-dark-elevated border-hud-line">
          {Object.entries(PERSPECTIVES).map(([key, def]) => (
            <SelectItem key={key} value={key} className="text-xs">
              {def.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="space-y-2">
        {STEMS.map((stem) => (
          <div key={stem.key} className="space-y-1" title={stem.hint}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-[Rajdhani] uppercase text-foreground/70">{stem.label}</span>
              <span className="text-[10px] font-[Orbitron] text-muted-foreground">{gains[stem.key]}%</span>
            </div>
            <Slider
              value={[gains[stem.key]]}
              min={0}
              max={200}
              step={5}
              onValueChange={([v]) => {
                setGains((g) => ({ ...g, [stem.key]: v }));
                onStemsChange({ [stem.key]: v / 100 });
              }}
              className="[&_[role=slider]]:bg-foreground/60 [&_[role=slider]]:border-foreground/60"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
