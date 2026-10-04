import { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import type { EngineConfiguration, PhysicalOverrides } from '../../../shared/engineTypes';
import { resolveEngineSpec } from '../../../shared/ess/resolveSpec';
import { solveFiringSchedule } from '../../../shared/ess/geometry';

interface PhysicsPanelProps {
  config: EngineConfiguration;
  onChange: (config: EngineConfiguration) => void;
}

type Key = keyof PhysicalOverrides;

/**
 * v16 physical build parameters. Every control shows the value the resolver would use (family
 * default) until it is overridden; "auto" returns it to the default.
 */
export function PhysicsPanel({ config, onChange }: PhysicsPanelProps) {
  const spec = useMemo(() => resolveEngineSpec(config), [config]);
  const schedule = useMemo(() => solveFiringSchedule(spec), [spec]);
  const ph = config.physical ?? {};

  const set = (key: Key, value: unknown) => onChange({ ...config, physical: { ...ph, [key]: value } });
  const reset = (key: Key) => {
    const next = { ...ph };
    delete next[key];
    onChange({ ...config, physical: next });
  };

  const slider = (key: Key, label: string, value: number, min: number, max: number, step: number, unit = '', digits = 0) => (
    <div className="space-y-1" key={key}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-[Rajdhani] uppercase text-foreground/75">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className={`text-[11px] font-[Orbitron] ${ph[key] !== undefined ? 'text-neon-cyan' : 'text-muted-foreground'}`}>
            {value.toFixed(digits)}{unit}
          </span>
          {ph[key] !== undefined && (
            <button className="text-[9px] uppercase text-muted-foreground hover:text-neon-cyan" onClick={() => reset(key)}>auto</button>
          )}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => set(key, v)}
        className="[&_[role=slider]]:bg-neon-cyan [&_[role=slider]]:border-neon-cyan" />
    </div>
  );

  const select = (key: Key, label: string, value: string, options: Array<[string, string]>) => (
    <div className="space-y-1" key={key}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-[Rajdhani] uppercase text-foreground/75">{label}</span>
        {ph[key] !== undefined && (
          <button className="text-[9px] uppercase text-muted-foreground hover:text-neon-cyan" onClick={() => reset(key)}>auto</button>
        )}
      </div>
      <Select value={value} onValueChange={(v) => set(key, isNaN(Number(v)) ? v : Number(v))}>
        <SelectTrigger className="h-7 text-xs bg-dark-surface border-hud-line"><SelectValue /></SelectTrigger>
        <SelectContent className="bg-dark-elevated border-hud-line">
          {options.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  const toggle = (key: Key, label: string, value: boolean, onValue: unknown = true) => (
    <div className="flex items-center justify-between" key={key}>
      <span className="text-[11px] font-[Rajdhani] uppercase text-foreground/75">{label}</span>
      <Switch checked={value} onCheckedChange={(v) => (onValue === true ? set(key, v) : v ? set(key, onValue) : reset(key))} />
    </div>
  );

  const section = (title: string) => (
    <div className="flex items-center gap-2 pt-2">
      <h4 className="text-[11px] font-semibold font-[Orbitron] text-neon-cyan uppercase tracking-wider">{title}</h4>
      <div className="flex-1 h-px bg-gradient-to-r from-neon-cyan/30 to-transparent" />
    </div>
  );

  const fi = spec.forcedInduction;
  const muffler = spec.exhaust.muffler;

  return (
    <div className="space-y-2.5">
      <div className="rounded border border-hud-line/30 p-2 text-[11px] font-[Rajdhani] text-foreground/80 space-y-0.5">
        <div>Bore × stroke {spec.boreMm.toFixed(1)} × {spec.strokeMm.toFixed(1)} mm · rod {spec.rodLengthMm.toFixed(0)} mm · bank {spec.bankAngleDeg}°</div>
        <div>Firing order {schedule.firingOrder.join('-')}</div>
        <div>Intervals {schedule.intervalsDeg.map((d) => Math.round(d)).join(' / ')}°</div>
        {schedule.notes.map((n) => <div key={n} className="text-neon-pink/80">{n}</div>)}
      </div>

      {section('Crank & combustion')}
      {select('crankType', 'Crank', spec.crank.type, [
        ['even-fire', 'Even-fire (split pins)'], ['cross-plane', 'Cross-plane'], ['flat-plane', 'Flat-plane'],
        ['common-pin', 'Common-pin (bank angle sets intervals)'], ['single-pin', 'Single-pin (radial / master rod)'],
      ])}
      {slider('compressionRatio', 'Compression ratio', spec.compressionRatio, 6, spec.diesel ? 24 : 16, 0.1, ':1', 1)}
      {slider('rodLengthMm', 'Rod length', spec.rodLengthMm, spec.strokeMm * 1.3, spec.strokeMm * 2.4, 1, ' mm')}
      {slider('inertiaKgM2', 'Rotating inertia', spec.inertiaKgM2, 0.01, 1.5, 0.005, ' kg·m²', 3)}

      {section('Valvetrain')}
      {select('valvesPerCylinder', 'Valves / cylinder', String(spec.valves.intakeCount + spec.valves.exhaustCount), [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']])}
      {slider('intakeDurationDeg', 'Intake duration @ .050"', spec.cam.intakeDurationDeg, 170, 320, 1, '°')}
      {slider('exhaustDurationDeg', 'Exhaust duration @ .050"', spec.cam.exhaustDurationDeg, 170, 320, 1, '°')}
      {slider('intakeCenterlineDeg', 'Intake centreline', spec.cam.intakeCenterlineDeg, 90, 130, 0.5, '° ATDC', 1)}
      {slider('exhaustCenterlineDeg', 'Exhaust centreline', spec.cam.exhaustCenterlineDeg, 90, 130, 0.5, '° BTDC', 1)}
      {slider('intakeLiftMm', 'Intake lift', spec.cam.intakeLiftMm, 4, 18, 0.1, ' mm', 1)}
      {slider('exhaustLiftMm', 'Exhaust lift', spec.cam.exhaustLiftMm, 4, 18, 0.1, ' mm', 1)}
      {slider('camLobeGamma', 'Lobe shape γ (ramp gentleness)', spec.cam.gamma, 0.5, 3, 0.05, '', 2)}
      {slider('intakePhaserDeg', 'Intake cam phaser authority', spec.cam.intakePhaserDeg, 0, 70, 1, '°')}
      {slider('exhaustPhaserDeg', 'Exhaust cam phaser authority', spec.cam.exhaustPhaserDeg, 0, 70, 1, '°')}
      {toggle('liftSwitchRpm', 'Two-step lift switching (VTEC-style)', spec.cam.liftSwitch !== null, Math.round(spec.calibration.redlineRpm * 0.7 / 50) * 50)}
      {spec.cam.liftSwitch && (<>
        {slider('liftSwitchRpm', 'Lift switch speed', spec.cam.liftSwitch.switchRpm, 2500, Math.max(3000, spec.calibration.redlineRpm), 50, ' rpm')}
        {slider('highCamIntakeDurationDeg', 'High-cam intake duration', spec.cam.liftSwitch.intakeDurationDeg, 180, 320, 1, '°')}
        {slider('highCamExhaustDurationDeg', 'High-cam exhaust duration', spec.cam.liftSwitch.exhaustDurationDeg, 180, 320, 1, '°')}
        {slider('highCamIntakeLiftMm', 'High-cam intake lift', spec.cam.liftSwitch.intakeLiftMm, 4, 18, 0.1, ' mm', 1)}
        {slider('highCamExhaustLiftMm', 'High-cam exhaust lift', spec.cam.liftSwitch.exhaustLiftMm, 4, 18, 0.1, ' mm', 1)}
      </>)}

      {section('Induction')}
      {slider('plenumVolumeL', 'Plenum volume', spec.intake.plenumVolumeL, 0.3, 15, 0.1, ' L', 1)}
      {slider('throttleDiameterMm', 'Throttle bore', spec.intake.throttleDiameterMm, 25, 130, 1, ' mm')}
      {slider('runnerDiameterMm', 'Runner diameter', spec.intake.runnerDiameterMm, 20, 80, 0.5, ' mm', 1)}
      {slider('intakeResonatorHz', 'Snorkel resonator tuned to (0 = none)', spec.intake.resonatorHz, 0, 400, 1, ' Hz')}
      {select('airFilter', 'Air filter', spec.intake.filter, [['oem-paper', 'OEM panel in airbox'], ['cone', 'Open cone'], ['sock', 'Sock / mesh'], ['none', 'None']])}

      {section('Exhaust')}
      {select('collector', 'Collector', spec.exhaust.collector, [
        ['bank', 'Per bank (4-1 / 3-1)'], ['firing-alternate', '180° (firing-alternate)'], ['pairs-then-bank', 'Tri-Y / 4-2-1'], ['all', 'All into one'], ['none', 'None (open primaries)'],
      ])}
      {slider('primaryDiameterMm', 'Primary diameter', spec.exhaust.primaryDiameterMm, 25, 75, 0.5, ' mm', 1)}
      {slider('pipeDiameterMm', 'System pipe diameter', spec.exhaust.pipeDiameterMm, 35, 120, 0.5, ' mm', 1)}
      {select('crossover', 'Crossover', spec.exhaust.crossover, [['none', 'None'], ['x-pipe', 'X-pipe'], ['h-pipe', 'H-pipe']])}
      {toggle('catalyst', 'Catalytic converter', spec.exhaust.catalyst)}
      {toggle('resonator', 'Resonator', spec.exhaust.resonator)}
      {select('muffler', 'Muffler', muffler.type, [['turbo', 'OEM multi-chamber'], ['chambered', 'Chambered'], ['straight-through', 'Straight-through (packed)'], ['glasspack', 'Glasspack'], ['none', 'None']])}
      {slider('droneTubeHz', 'J-pipe drone tube tuned to', spec.exhaust.quarterWaveTubesHz[0] ?? 0, 0, 400, 1, ' Hz')}
      {slider('helmholtzHz', 'Helmholtz resonator tuned to', spec.exhaust.helmholtz[0]?.tuneHz ?? 0, 0, 400, 1, ' Hz')}
      {spec.exhaust.helmholtz.length > 0 && slider('helmholtzVolumeL', 'Helmholtz cavity volume', spec.exhaust.helmholtz[0].volumeL, 0.3, 8, 0.1, ' L', 1)}
      {select('exhaustValveMode', 'Valved exhaust (muffler bypass)', spec.exhaust.valve?.mode ?? 'none', [['none', 'No valve'], ['auto', 'Auto (opens with rpm/load)'], ['open', 'Always open'], ['closed', 'Always closed']])}
      {spec.exhaust.valve && slider('exhaustValveOpenRpm', 'Valve opening speed', spec.exhaust.valve.openRpm, 1000, spec.calibration.redlineRpm, 50, ' rpm')}
      {slider('mufflerPacking', 'Packing density', muffler.packing, 0, 1, 0.05, '', 2)}
      {slider('tailpipeDiameterMm', 'Tailpipe diameter', spec.exhaust.tailpipeDiameterMm, 35, 130, 0.5, ' mm', 1)}

      {section('Calibration')}
      {slider('idleRpm', 'Idle speed', spec.calibration.idleRpm, 400, 1600, 10, ' rpm')}
      {slider('afterfireTendency', 'Afterfire tendency', spec.calibration.afterfireTendency, 0, 1, 0.01, '', 2)}
      {!spec.diesel && slider('fuelOctane', 'Fuel octane (RON)', spec.calibration.fuelOctane, 80, 115, 1)}
      {slider('buildTolerance', 'Build tolerance (cyl-to-cyl spread)', spec.calibration.buildTolerance, 0, 1, 0.05, '', 2)}
      {!spec.diesel && toggle('knockControl', 'Knock control (off = audible knock)', spec.calibration.knockControl)}
      {spec.diesel && (<>
        {section('Diesel injection')}
        {toggle('pilotInjection', 'Pilot injection (common rail: softer clatter)', spec.diesel.pilotInjection)}
        {slider('injectionAdvanceDeg', 'Main injection at rated speed', spec.diesel.injectionAdvanceDeg, 0, 25, 0.5, '° BTDC', 1)}
        {slider('cetaneNumber', 'Fuel cetane number', spec.diesel.cetane, 35, 65, 1)}
        {slider('dieselFullLoadFuelMg', 'Full-load fuel per stroke', spec.diesel.fullLoadFuelMg, 5, 300, 1, ' mg')}
      </>)}

      {fi.kind === 'turbo' && (<>
        {section('Turbocharger')}
        {slider('turboCount', 'Turbochargers', fi.count, 1, 4, 1)}
        {slider('compressorWheelMm', 'Compressor wheel', fi.compressorWheelDiameterMm, 30, 130, 1, ' mm')}
      </>)}
      {fi.kind === 'supercharger' && fi.type !== 'centrifugal' && (<>
        {section('Supercharger')}
        {slider('superchargerDisplacementL', 'Blower displacement / rev', fi.displacementL, 0.4, 5, 0.05, ' L', 2)}
        {slider('superchargerDriveRatio', 'Drive ratio', fi.driveRatio, 1, 4, 0.05, ':1', 2)}
      </>)}

      <Button variant="outline" size="sm" className="w-full text-xs border-hud-line" onClick={() => onChange({ ...config, physical: {} })}>
        Reset all physical overrides
      </Button>
    </div>
  );
}
