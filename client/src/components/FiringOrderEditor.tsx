import { useMemo, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EngineConfiguration } from '../../../shared/engineTypes';
import { validateFiringOrder } from '../../../shared/engineTypes';
import { resolveEngineSpec } from '../../../shared/ess/resolveSpec';
import { solveFiringSchedule } from '../../../shared/ess/geometry';

interface FiringOrderEditorProps {
  config: EngineConfiguration;
  onChange: (config: EngineConfiguration) => void;
}

/**
 * The firing order the crank actually produces, with three ways to change it: a preset (Cross-Four
 * engines: which cylinder of each opposed pair leads), a tap on a cylinder to swap it with its
 * opposite (Cross-Four), or a typed order. A typed order is checked against the crank: one it
 * cannot fire in is refused with the reason, and the engine keeps its current order.
 */
export function FiringOrderEditor({ config, onChange }: FiringOrderEditorProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const spec = useMemo(() => resolveEngineSpec(config), [config]);
  const schedule = useMemo(() => solveFiringSchedule(spec), [spec]);
  const n = spec.cylinders;
  const custom = config.advanced?.firingOrder?.length === n;
  const crossFour = spec.layout === 'x' && !!spec.x && spec.x.pins !== 'shared' && spec.cycle === 'four-stroke';
  if (spec.cycle === 'rotary') return null;

  const setOrder = (order: number[] | null) => {
    const { firingOrder: _old, ...rest } = config.advanced ?? {};
    void _old;
    onChange({ ...config, advanced: order ? { ...rest, firingOrder: order } : rest });
  };

  const apply = () => {
    const parsed = text.split(/[,\s·-]+/).filter(Boolean).map(Number);
    const check = validateFiringOrder(parsed, n);
    if (!check.valid) {
      setError(check.errors[0]);
      return;
    }
    const trial = solveFiringSchedule({ ...spec, firingOrder: parsed });
    if (!trial.requestedOrderHonoured) {
      setError('This crank cannot fire in that order: each cylinder can only fire at its own top dead centre or one revolution later.');
      return;
    }
    setError(null);
    setText('');
    setOrder(parsed);
  };

  /** Cross-Four: swap a cylinder with the opposed one it shares a top dead centre with. */
  const swapWithOpposite = (cyl: number) => {
    const partner = (cyl - 1) % 4 < 2 ? cyl + 2 : cyl - 2;
    setError(null);
    setOrder(schedule.firingOrder.map((c) => (c === cyl ? partner : c === partner ? cyl : c)));
  };

  const preset = custom ? 'custom' : config.physical?.xFiring ?? 'default';

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Firing order</label>
      {crossFour && (
        <Select
          value={preset}
          onValueChange={(v) => {
            if (v === 'custom') return;
            const { firingOrder: _old, ...rest } = config.advanced ?? {};
            void _old;
            setError(null);
            onChange({ ...config, advanced: rest, physical: { ...config.physical, xFiring: v as 'default' | 'even-sides' | 'bunched-sides' } });
          }}
        >
          <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-dark-elevated border-hud-line">
            <SelectItem value="default">Preset: solver's choice</SelectItem>
            <SelectItem value="even-sides">Preset: each side as even as possible</SelectItem>
            <SelectItem value="bunched-sides">Preset: each side bunched (lumpier)</SelectItem>
            {custom && <SelectItem value="custom">Custom order</SelectItem>}
          </SelectContent>
        </Select>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        {schedule.firingOrder.map((cyl, i) =>
          crossFour ? (
            <button
              key={i}
              type="button"
              title={`Swap cylinder ${cyl} with the opposed cylinder ${(cyl - 1) % 4 < 2 ? cyl + 2 : cyl - 2}`}
              onClick={() => swapWithOpposite(cyl)}
              className="min-w-6 text-xs font-[Orbitron] text-neon-cyan bg-dark-bg px-1.5 py-0.5 rounded border border-hud-line/40 hover:border-neon-cyan hover:bg-neon-cyan/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-neon-cyan"
            >
              {cyl}
            </button>
          ) : (
            <span key={i} className="min-w-6 text-center text-xs font-[Orbitron] text-neon-cyan bg-dark-bg px-1.5 py-0.5 rounded border border-hud-line/30">
              {cyl}
            </span>
          ),
        )}
      </div>
      <p className="text-[10px] font-[Rajdhani] text-muted-foreground">
        {schedule.intervalsDeg.length > 12 ? `${schedule.intervalsDeg.length} firings per cycle` : `Intervals ${schedule.intervalsDeg.map((d) => Math.round(d)).join(' / ')}°`}
        {crossFour ? ' · tap a cylinder to swap it with its opposite' : ''}
      </p>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
          placeholder={`Type an order, e.g. ${schedule.firingOrder.slice(0, 4).join(', ')}…`}
          aria-label="Custom firing order"
          className="h-8 w-full min-w-0 rounded border border-hud-line bg-dark-bg px-2 text-xs font-[Orbitron] text-foreground outline-none focus:border-neon-cyan/70"
        />
        <button
          type="button"
          onClick={apply}
          aria-label="Apply firing order"
          className="h-8 px-2 rounded border border-hud-line text-muted-foreground hover:border-neon-cyan/60 hover:text-neon-cyan"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      </div>
      {custom && (
        <button type="button" onClick={() => { setError(null); setOrder(null); }} className="text-[10px] font-[Rajdhani] uppercase tracking-wide text-muted-foreground hover:text-neon-cyan">
          Back to the preset order
        </button>
      )}
      {error && (
        <div className="flex items-start gap-1 text-destructive text-[10px]">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
