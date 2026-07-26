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
}: PlaybackControllerProps) {
  const [sweepActive, setSweepActive] = useState(false);
  const sweepRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const sweepRpmRef = useRef(800);

  const clearSweepTimers = useCallback(() => {
    if (sweepRef.current) {
      cancelAnimationFrame(sweepRef.current);
      sweepRef.current = null;
    }
    if (holdTimeoutRef.current) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  }, []);

  const stopSweep = useCallback(() => {
    clearSweepTimers();
    setSweepActive(false);
    onThrottleChange(0);
    onRpmChange(800);
  }, [clearSweepTimers, onThrottleChange, onRpmChange]);

  const startSweep = useCallback(() => {
    if (!isPlaying) return;
    clearSweepTimers();
    setSweepActive(true);
    sweepRpmRef.current = 800;
    onRpmChange(800);

    const sweepDuration = 6000; // 6 seconds idle to redline
    const startTime = performance.now();
    const startRpm = 800;
    const endRpm = redline;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / sweepDuration, 1);
      // Ease-in-out for natural feel
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      
      const currentRpm = startRpm + (endRpm - startRpm) * eased;
      sweepRpmRef.current = currentRpm;
      onThrottleChange(eased);
      onRpmChange(currentRpm);

      if (progress < 1) {
        sweepRef.current = requestAnimationFrame(animate);
      } else {
        // Hold at redline briefly then back to idle
        holdTimeoutRef.current = window.setTimeout(() => {
          onThrottleChange(0);
          onRpmChange(800);
          setSweepActive(false);
          holdTimeoutRef.current = null;
        }, 500);
      }
    };

    sweepRef.current = requestAnimationFrame(animate);
  }, [clearSweepTimers, isPlaying, redline, onThrottleChange, onRpmChange]);

  useEffect(() => {
    return () => clearSweepTimers();
  }, [clearSweepTimers]);

  useEffect(() => {
    if (sweepActive) {
      stopSweep();
    }
  }, [resetKey]);

  return (
    <div className="space-y-5">
      {/* Start/Stop Controls */}
      <div className="flex items-center gap-3">
        <Button
          onClick={isPlaying ? onStop : onStart}
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
          className="[&_[role=slider]]:bg-neon-cyan [&_[role=slider]]:border-neon-cyan [&_[role=slider]]:shadow-[0_0_6px_oklch(0.75_0.18_195/0.5)]"
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
          className="[&_[role=slider]]:bg-neon-purple [&_[role=slider]]:border-neon-purple [&_[role=slider]]:shadow-[0_0_6px_oklch(0.60_0.22_300/0.5)]"
        />
      </div>

      {/* Direct RPM Control */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
              Direct RPM
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
            {Math.round(playbackState.targetRpm)}
          </span>
        </div>
        <Slider
          value={[playbackState.targetRpm]}
          onValueChange={([v]) => onRpmChange(v)}
          min={600}
          max={redline}
          step={50}
          disabled={!isPlaying || sweepActive}
          className="[&_[role=slider]]:bg-foreground/60 [&_[role=slider]]:border-foreground/60"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!isPlaying || sweepActive}
          onClick={() => { onThrottleChange(0); onRpmChange(800); }}
          className="text-xs font-[Rajdhani] border-hud-line hover:border-neon-cyan/50 hover:text-neon-cyan"
        >
          Idle
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!isPlaying || sweepActive}
          onClick={() => onThrottleChange(0.5)}
          className="text-xs font-[Rajdhani] border-hud-line hover:border-neon-cyan/50 hover:text-neon-cyan"
        >
          Rev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!isPlaying || sweepActive}
          onClick={() => onThrottleChange(1)}
          className="text-xs font-[Rajdhani] border-hud-line hover:border-neon-pink/50 hover:text-neon-pink"
        >
          Redline
        </Button>
      </div>

      {/* RPM Sweep Automation */}
      <Button
        variant="outline"
        size="sm"
        disabled={!isPlaying}
        onClick={sweepActive ? stopSweep : startSweep}
        className={`w-full text-xs font-[Rajdhani] uppercase tracking-wide transition-all duration-200 ${
          sweepActive
            ? 'border-neon-pink text-neon-pink bg-neon-pink/10 box-glow-pink'
            : 'border-hud-line hover:border-neon-cyan/50 hover:text-neon-cyan'
        }`}
      >
        <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
        {sweepActive ? 'Stop Sweep' : 'RPM Sweep (Idle → Redline)'}
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
      </div>
    </div>
  );
}
