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
  autoLevel: boolean;
  onAutoLevelChange: (on: boolean) => void;
  /** Listener volume, −100 (silence) … 0 (as leveled) … +100. */
  volume: number;
  onVolumeChange: (volume: number) => void;
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
export function ListenerPanel({ perspective, onPerspectiveChange, onStemsChange, autoLevel, onAutoLevelChange, volume, onVolumeChange }: ListenerPanelProps) {
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
      <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Playback level">
        {([
          [true, 'Auto level', 'A slow gain rider keeps every engine at a comfortable playback level (what a recordist does).'],
          [false, 'Physical level', "The microphone's calibrated SPL: a quiet diesel stays quiet, a straight-piped V10 stays loud (peaks are limited, never clipped)."],
        ] as const).map(([on, label, hint]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={autoLevel === on}
            title={hint}
            onClick={() => onAutoLevelChange(on)}
            className={`h-7 rounded border text-[10px] font-[Rajdhani] uppercase tracking-wide ${autoLevel === on ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' : 'border-hud-line text-foreground/70'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="space-y-1"
        title="0 is the level the leveler sets. −100 is silence. Above 0 the sound is turned up by as much as 12 dB; a limiter holds the peaks under full scale, so loud passages get denser instead of clipping. The setting is kept in this browser and applies to exports unless Normalize is on."
      >
        <div className="flex items-center justify-between">
          <span id="listener-volume-label" className="text-[10px] font-[Rajdhani] uppercase text-foreground/70">Volume</span>
          <span className="flex items-center gap-2">
            {volume !== 0 && (
              <button type="button" onClick={() => onVolumeChange(0)} className="text-[10px] font-[Rajdhani] uppercase text-neon-cyan/80 hover:text-neon-cyan">
                Reset
              </button>
            )}
            <span className="text-[10px] font-[Orbitron] text-muted-foreground" aria-live="off">
              {volume > 0 ? `+${volume}` : volume}
              {volume === -100 ? ' (silent)' : ''}
            </span>
          </span>
        </div>
        <Slider value={[volume]} min={-100} max={100} step={1} onValueChange={([v]) => onVolumeChange(v)} aria-labelledby="listener-volume-label" />
      </div>
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
              tone="muted"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
