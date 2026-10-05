import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Power, Square, Gauge, Wind, Info, TrendingUp } from 'lucide-react';
import type { PlaybackState } from '../../../shared/engineTypes';

interface PlaybackControllerProps {
  isPlaying: boolean;
  playbackState: PlaybackState;
  onStart: () => void;
  onStop: () => void;
  onThrottleChange: (value: number) => void;
  onLoadChange: (value: number) => void;
  onRpmChange: (value: number) => void;
  redline: number;
  resetKey: string;
  driveMode?: 'free' | 'dyno' | 'vehicle';
  onDriveModeChange?: (mode: 'free' | 'dyno' | 'vehicle') => void;
  /** Vehicle mode: gear shifts and options. */
  onShift?: (dir: 1 | -1) => void;
  /** Crank (true) or switch off (false) the simulated engine. */
  onIgnition?: (on: boolean) => void;
  vehicleOptions?: { autoShift: boolean; launchControl: boolean; brake: number };
  onVehicleOptions?: (options: Partial<{ autoShift: boolean; launchControl: boolean; brake: number }>) => void;
}

export function PlaybackController({
  isPlaying,
  playbackState,
  onStart,
  onStop,
  onThrottleChange,
  onLoadChange,
  onRpmChange,
  redline,
  resetKey,
  driveMode = 'free',
  onDriveModeChange,
  onShift,
  onIgnition,
  vehicleOptions,
  onVehicleOptions,
}: PlaybackControllerProps) {
  const blipRef = useRef<number | null>(null);
  const [sweepActive, setSweepActive] = useState(false);
  const sweepRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const sweepRunIdRef = useRef(0);
  const resetKeyRef = useRef(resetKey);

  const clearSweepTimers = useCallback(() => {
    sweepRunIdRef.current += 1;
    if (sweepRef.current !== null) {
      cancelAnimationFrame(sweepRef.current);
      sweepRef.current = null;
    }
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  }, []);

  const stopSweep = useCallback(() => {
    clearSweepTimers();
    setSweepActive(false);
    onThrottleChange(0);
    onDriveModeChange?.('free');
  }, [clearSweepTimers, onThrottleChange, onDriveModeChange]);

  /** Full-throttle dyno pull to redline, then lift off the throttle and let the engine run free. */
  const startDynoPull = useCallback(() => {
    if (!isPlaying) return;
    clearSweepTimers();
    setSweepActive(true);
    const sweepRunId = sweepRunIdRef.current + 1;
    sweepRunIdRef.current = sweepRunId;
    const startRpm = Math.max(1000, playbackState.rpm || 1000);
    onRpmChange(startRpm);
    onThrottleChange(1);
    const duration = 6000;
    const t0 = performance.now();
    const animate = (now: number) => {
      if (sweepRunId !== sweepRunIdRef.current) return;
      const progress = Math.min((now - t0) / duration, 1);
      onRpmChange(startRpm + (redline - startRpm) * progress);
      if (progress < 1) {
        sweepRef.current = requestAnimationFrame(animate);
      } else {
        sweepRef.current = null;
        holdTimeoutRef.current = window.setTimeout(() => {
          if (sweepRunId !== sweepRunIdRef.current) return;
          onThrottleChange(0);
          onDriveModeChange?.('free');
          setSweepActive(false);
          holdTimeoutRef.current = null;
        }, 400);
      }
    };
    sweepRef.current = requestAnimationFrame(animate);
  }, [clearSweepTimers, isPlaying, onDriveModeChange, onRpmChange, onThrottleChange, playbackState.rpm, redline]);

  /** Quick actions run the engine free unless the car is being driven, where they work the pedal. */
  const leaveDyno = useCallback(() => {
    if (driveMode !== 'vehicle') onDriveModeChange?.('free');
  }, [driveMode, onDriveModeChange]);

  const blip = useCallback(() => {
    if (blipRef.current !== null) window.clearTimeout(blipRef.current);
    leaveDyno();
    onThrottleChange(0.85);
    blipRef.current = window.setTimeout(() => {
      onThrottleChange(0);
      blipRef.current = null;
    }, 260);
  }, [leaveDyno, onThrottleChange]);

  const handleStopEngine = useCallback(() => {
    stopSweep();
    onStop();
  }, [stopSweep, onStop]);

  useEffect(() => {
    return () => clearSweepTimers();
  }, [clearSweepTimers]);

  useEffect(() => {
    if (!isPlaying && sweepActive) {
      stopSweep();
    }
  }, [isPlaying, sweepActive, stopSweep]);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
    } else {
      return;
    }

    if (sweepActive) {
      stopSweep();
    }
  }, [resetKey, sweepActive, stopSweep]);

  return (
    <div className="space-y-5">
      {/* Start/Stop Controls */}
      <div className="flex items-center gap-3">
        <Button
          onClick={isPlaying ? handleStopEngine : onStart}
          className={`flex-1 h-12 font-[Orbitron] text-sm uppercase tracking-wider transition-all duration-200 ${
            isPlaying
              ? 'bg-neon-pink/20 border border-neon-pink text-neon-pink hover:bg-neon-pink/30 box-glow-pink'
              : 'bg-neon-cyan/20 border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/30 box-glow-cyan'
          }`}
          variant="outline"
        >
          {isPlaying ? (
            <>
              <Square className="w-4 h-4 mr-2" />
              Kill Engine
            </>
          ) : (
            <>
              <Power className="w-4 h-4 mr-2" />
              Start Engine
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(['free', 'dyno', 'vehicle'] as const).map((mode) => (
          <Button
            key={mode}
            variant="outline"
            size="sm"
            disabled={!isPlaying || sweepActive}
            onClick={() => onDriveModeChange?.(mode)}
            className={`text-xs font-[Rajdhani] uppercase tracking-wide ${driveMode === mode ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' : 'border-hud-line'}`}
          >
            {mode === 'free' ? 'Free rev' : mode === 'dyno' ? 'Dyno hold' : 'Drive'}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" disabled={!isPlaying || playbackState.telemetry?.engineState !== 'off'} onClick={() => onIgnition?.(true)}
          className="text-xs font-[Rajdhani] uppercase border-hud-line">Crank / start</Button>
        <Button variant="outline" size="sm" disabled={!isPlaying || playbackState.telemetry?.engineState === 'off'} onClick={() => onIgnition?.(false)}
          className="text-xs font-[Rajdhani] uppercase border-hud-line">Ignition off</Button>
      </div>

      {driveMode === 'vehicle' && (
        <div className="space-y-2 rounded border border-hud-line/30 p-2">
          <div className="grid grid-cols-4 gap-2 items-center">
            <Button variant="outline" size="sm" disabled={!isPlaying} onClick={() => onShift?.(-1)} className="text-xs border-hud-line">Shift −</Button>
            <div className="text-center">
              <span className="block text-[9px] font-[Rajdhani] text-muted-foreground uppercase">Gear</span>
              <span className="text-lg font-[Orbitron] text-neon-cyan">{playbackState.telemetry?.gear ?? 1}</span>
            </div>
            <div className="text-center">
              <span className="block text-[9px] font-[Rajdhani] text-muted-foreground uppercase">km/h</span>
              <span className="text-lg font-[Orbitron] text-foreground/90">{Math.round(playbackState.telemetry?.speedKmh ?? 0)}</span>
            </div>
            <Button variant="outline" size="sm" disabled={!isPlaying} onClick={() => onShift?.(1)} className="text-xs border-hud-line">Shift +</Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => onVehicleOptions?.({ autoShift: !vehicleOptions?.autoShift })}
              className={`text-[10px] uppercase ${vehicleOptions?.autoShift ? 'border-neon-cyan text-neon-cyan' : 'border-hud-line'}`}>Auto-shift</Button>
            <Button variant="outline" size="sm" onClick={() => onVehicleOptions?.({ launchControl: !vehicleOptions?.launchControl })}
              className={`text-[10px] uppercase ${vehicleOptions?.launchControl ? 'border-neon-pink text-neon-pink' : 'border-hud-line'}`}>Launch ctrl</Button>
            <Button variant="outline" size="sm" disabled={!isPlaying}
              onPointerDown={() => onVehicleOptions?.({ brake: 1 })} onPointerUp={() => onVehicleOptions?.({ brake: 0 })} onPointerLeave={() => onVehicleOptions?.({ brake: 0 })}
              className="text-[10px] uppercase border-hud-line">Brake (hold)</Button>
          </div>
          <p className="text-[10px] font-[Rajdhani] text-muted-foreground">
            Automated clutch: press the pedal from a standstill to launch. Flat-shifts cut ignition with the pedal held; downshifts blip to rev-match.
          </p>
        </div>
      )}

      {/* Throttle Control */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-neon-cyan/70" />
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
              Throttle
            </label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px] text-xs">
                Controls how much air enters the engine. Higher throttle = more combustion intensity = louder, higher-pitched sound with more harmonic content.
              </TooltipContent>
            </Tooltip>
          </div>
          <span className="text-xs font-[Orbitron] text-neon-cyan">
            {Math.round(playbackState.throttle * 100)}%
          </span>
        </div>
        <Slider
          value={[playbackState.throttle * 100]}
          onValueChange={([v]) => onThrottleChange(v / 100)}
          min={0}
          max={100}
          step={1}
          disabled={!isPlaying || sweepActive}
          tone="cyan"
        />
        {/* Throttle bar visualization */}
        <div className="h-2 bg-dark-surface rounded-full overflow-hidden border border-hud-line/30">
          <div
            className="h-full bg-gradient-to-r from-neon-cyan/60 to-neon-cyan transition-all duration-75"
            style={{ 
              width: `${playbackState.throttle * 100}%`,
              boxShadow: '0 0 8px oklch(0.75 0.18 195 / 0.4)',
            }}
          />
        </div>
      </div>

      {/* Load Control */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wind className="w-3.5 h-3.5 text-neon-purple/70" />
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
              Load
            </label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px] text-xs">
                Simulates mechanical resistance on the engine (climbing a hill, towing). Higher load deepens the exhaust tone and increases combustion pulse intensity.
              </TooltipContent>
            </Tooltip>
          </div>
          <span className="text-xs font-[Orbitron] text-neon-purple">
            {Math.round(playbackState.load * 100)}%
          </span>
        </div>
        <Slider
          value={[playbackState.load * 100]}
          onValueChange={([v]) => onLoadChange(v / 100)}
          min={0}
          max={100}
          step={1}
          disabled={!isPlaying}
          tone="purple"
        />
      </div>

      {/* Direct RPM Control */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
              {driveMode === 'dyno' ? 'Dyno RPM set-point' : 'Engine RPM (free running)'}
            </label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px] text-xs">
                Directly sets engine speed. The engine simulates inertia when transitioning between RPM values, just like a real engine takes time to spool up or down.
              </TooltipContent>
            </Tooltip>
          </div>
          <span className="text-xs font-[Orbitron] text-foreground/60">
            {Math.round(driveMode === 'free' ? playbackState.rpm : playbackState.targetRpm)}
          </span>
        </div>
        <Slider
          value={[driveMode === 'free' ? playbackState.rpm : playbackState.targetRpm]}
          onValueChange={([v]) => onRpmChange(v)}
          min={600}
          max={redline}
          step={50}
          disabled={!isPlaying || sweepActive}
          tone="muted"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!isPlaying || sweepActive}
          onClick={() => { onThrottleChange(0); leaveDyno(); }}
          className="text-xs font-[Rajdhani] border-hud-line hover:border-neon-cyan/50 hover:text-neon-cyan"
        >
          Idle
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!isPlaying || sweepActive}
          onClick={blip}
          className="text-xs font-[Rajdhani] border-hud-line hover:border-neon-cyan/50 hover:text-neon-cyan"
        >
          Blip
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!isPlaying || sweepActive}
          onClick={() => { leaveDyno(); onThrottleChange(1); }}
          className="text-xs font-[Rajdhani] border-hud-line hover:border-neon-pink/50 hover:text-neon-pink"
        >
          Full throttle
        </Button>
      </div>

      {/* RPM Sweep Automation */}
      <Button
        variant="outline"
        size="sm"
        disabled={!isPlaying}
        onClick={sweepActive ? stopSweep : startDynoPull}
        className={`w-full text-xs font-[Rajdhani] uppercase tracking-wide transition-all duration-200 ${
          sweepActive
            ? 'border-neon-pink text-neon-pink bg-neon-pink/10 box-glow-pink'
            : 'border-hud-line hover:border-neon-cyan/50 hover:text-neon-cyan'
        }`}
      >
        <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
        {sweepActive ? 'Stop Sweep' : 'Dyno Pull (WOT → Redline, Lift)'}
      </Button>

      {/* Engine Telemetry */}
      <div className="space-y-2">
        <h4 className="text-xs font-[Rajdhani] text-muted-foreground uppercase tracking-wide">
          Engine Telemetry
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="hud-panel rounded p-2.5 border border-hud-line/20">
            <span className="text-[10px] font-[Rajdhani] text-muted-foreground uppercase">RPM</span>
            <p className="text-sm font-[Orbitron] font-bold text-neon-cyan">
              {Math.round(playbackState.rpm)}
            </p>
          </div>
          <div className="hud-panel rounded p-2.5 border border-hud-line/20">
            <span className="text-[10px] font-[Rajdhani] text-muted-foreground uppercase">Throttle</span>
            <p className="text-sm font-[Orbitron] font-bold text-neon-cyan">
              {Math.round(playbackState.throttle * 100)} %
            </p>
          </div>
          <div className="hud-panel rounded p-2.5 border border-hud-line/20">
            <span className="text-[10px] font-[Rajdhani] text-muted-foreground uppercase">Load</span>
            <p className="text-sm font-[Orbitron] font-bold text-neon-purple">
              {Math.round(playbackState.load * 100)} %
            </p>
          </div>
          <div className="hud-panel rounded p-2.5 border border-hud-line/20">
            <span className="text-[10px] font-[Rajdhani] text-muted-foreground uppercase">Boost</span>
            <p className="text-sm font-[Orbitron] font-bold text-neon-pink">
              {playbackState.boost.toFixed(1)}<span className="text-[9px] ml-0.5">PSI</span>
            </p>
          </div>
        </div>
        {playbackState.telemetry && (
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {(() => {
              const t = playbackState.telemetry;
              const cells: Array<[string, string]> = [
                ['Brake torque', `${Math.round(t.brakeTorqueNm)} N·m`],
                ['Power', `${Math.round(t.powerKw)} kW`],
                ['MAP', `${Math.round(t.mapKpa)} kPa`],
                ['EGT', `${Math.round(t.egtC)} °C`],
                ['IMEP', `${t.imepBar.toFixed(1)} bar`],
                ['P peak', `${Math.round(t.peakPressureBar)} bar @ ${Math.round(t.peakPressureAngle)}°`],
                ['Vol. eff.', `${Math.round(t.volumetricEfficiency * 100)} %`],
                ['Cam timing', `in +${t.intakeCamAdvanceDeg.toFixed(0)}° · ex −${t.exhaustCamRetardDeg.toFixed(0)}°${t.highCam ? ' · HIGH CAM' : ''}`],
                ['Knock retard', `${t.knockRetardDeg.toFixed(1)}° · ${t.knockEvents} events`],
                ['SPL @ mic', `${t.splDb.toFixed(0)} dB`],
                ['State', t.limiter ? 'LIMITER' : t.fuelCut ? 'FUEL CUT' : t.afterfire ? `${t.afterfire} pops` : 'firing'],
              ];
              return cells.map(([label, value]) => (
                <div key={label} className="rounded p-1.5 border border-hud-line/20">
                  <span className="block text-[9px] font-[Rajdhani] text-muted-foreground uppercase">{label}</span>
                  <span className="text-[11px] font-[Orbitron] text-foreground/90">{value}</span>
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
